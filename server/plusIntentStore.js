import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const SENDING_STALE_MS = 2 * 60 * 1000;

function hashIp(ip) {
  return createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 24);
}

function stampOf(at) {
  return typeof at === 'number' ? at : at.getTime();
}

export function createPlusIntentStore({
  filePath = null,
  limit = 6,
  windowMs = 10 * 60 * 1000
} = {}) {
  let memory = { intents: {}, hits: {} };

  function load() {
    if (!filePath) return memory;
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      return {
        intents: parsed?.intents && typeof parsed.intents === 'object' ? parsed.intents : {},
        hits: parsed?.hits && typeof parsed.hits === 'object' ? parsed.hits : {}
      };
    } catch {
      return { intents: {}, hits: {} };
    }
  }

  function save(data) {
    if (!filePath) {
      memory = data;
      return;
    }
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, filePath);
  }

  function withLock(fn) {
    if (!filePath) return fn();
    const lockPath = `${filePath}.lock`;
    mkdirSync(dirname(filePath), { recursive: true });
    const started = Date.now();
    let fd;
    for (;;) {
      try {
        fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > 10_000) unlinkSync(lockPath);
        } catch {
          /* another process took the stale lock */
        }
        if (Date.now() - started > 3000) {
          const err = new Error('lock_timeout');
          err.code = 'lock_timeout';
          throw err;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      }
    }
    try {
      return fn();
    } finally {
      try { closeSync(fd); } catch { /* already closed */ }
      try { unlinkSync(lockPath); } catch { /* already released */ }
    }
  }

  function claim({ requestId, plan, source, ip, at }) {
    return withLock(() => {
      const data = load();
      const stamp = stampOf(at);
      const existing = data.intents[requestId];
      if (existing?.status === 'sent') return { status: 'sent' };
      if (existing?.status === 'sending' && stamp - Number(existing.updatedAt || 0) < SENDING_STALE_MS) {
        return { status: 'in_progress' };
      }
      const key = hashIp(ip);
      const recent = (data.hits[key] || []).filter((item) => stamp - item < windowMs);
      if (!existing?.counted && recent.length >= limit) {
        data.hits[key] = recent;
        save(data);
        return { status: 'rate_limited' };
      }
      if (!existing?.counted) recent.push(stamp);
      data.hits[key] = recent.slice(-limit);
      data.intents[requestId] = {
        status: 'sending',
        plan,
        source,
        counted: true,
        updatedAt: stamp
      };
      for (const id of Object.keys(data.intents)) {
        if (stamp - Number(data.intents[id].updatedAt || 0) > 14 * DAY_MS) delete data.intents[id];
      }
      save(data);
      return { status: 'claimed' };
    });
  }

  function mark(requestId, status, at) {
    return withLock(() => {
      const data = load();
      const existing = data.intents[requestId];
      if (!existing) return;
      if (status === 'failed' && existing.status === 'sent') return;
      data.intents[requestId] = { ...existing, status, updatedAt: stampOf(at) };
      save(data);
    });
  }

  return {
    claim,
    markSent(requestId, at) { mark(requestId, 'sent', at); },
    markFailed(requestId, at) { mark(requestId, 'failed', at); }
  };
}
