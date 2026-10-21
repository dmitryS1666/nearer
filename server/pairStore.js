import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const TOKEN_BYTES = 32;

export function hashSecret(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function hashesEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function makeCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

export function normalizePairCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function loadPairs(filePath) {
  if (!filePath) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed.pairs) ? parsed.pairs : [];
  } catch {
    return [];
  }
}

/**
 * Pairing records only: code hash, device token hashes, expiry.
 * Answers and names are never accepted here.
 */
export function createPairStore({ filePath = null, now = () => Date.now(), ttlMs = 20 * 60 * 1000, maxPairs = 5000 } = {}) {
  let pairs = loadPairs(filePath);

  function persist() {
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pairs }));
    renameSync(tmp, filePath);
  }

  function prune(at) {
    const before = pairs.length;
    pairs = pairs.filter((pair) => pair.partnerTokenHash || pair.expiresAt > at);
    if (pairs.length > maxPairs) pairs = pairs.slice(-maxPairs);
    return before !== pairs.length;
  }

  function findByToken(token) {
    if (!token) return null;
    const tokenHash = hashSecret(token);
    return pairs.find((pair) => hashesEqual(pair.creatorTokenHash, tokenHash) || (pair.partnerTokenHash && hashesEqual(pair.partnerTokenHash, tokenHash))) || null;
  }

  return {
    create(at = now()) {
      if (prune(at)) persist();
      const code = makeCode();
      const deviceToken = randomBytes(TOKEN_BYTES).toString('base64url');
      const pair = {
        id: randomBytes(16).toString('hex'),
        codeHash: hashSecret(code),
        expiresAt: at + ttlMs,
        creatorTokenHash: hashSecret(deviceToken),
        partnerTokenHash: null,
        createdAt: at,
        linkedAt: null
      };
      pairs.push(pair);
      persist();
      return {
        pairId: pair.id,
        code,
        deviceToken,
        expiresAt: new Date(pair.expiresAt).toISOString(),
        role: 'a',
        status: 'waiting'
      };
    },

    join(rawCode, at = now()) {
      if (prune(at)) persist();
      const code = normalizePairCode(rawCode);
      if (code.length !== CODE_LENGTH) return null;
      const codeHash = hashSecret(code);
      const pair = pairs.find((item) => item.codeHash && hashesEqual(item.codeHash, codeHash) && !item.partnerTokenHash && item.expiresAt > at);
      if (!pair) return null;
      const deviceToken = randomBytes(TOKEN_BYTES).toString('base64url');
      pair.partnerTokenHash = hashSecret(deviceToken);
      pair.codeHash = null;
      pair.linkedAt = at;
      persist();
      return { pairId: pair.id, deviceToken, role: 'b', status: 'linked' };
    },

    me(token, at = now()) {
      const pair = findByToken(token);
      if (!pair) return null;
      if (!pair.partnerTokenHash && pair.expiresAt <= at) return null;
      const tokenHash = hashSecret(token);
      const role = hashesEqual(pair.creatorTokenHash, tokenHash) ? 'a' : 'b';
      const linked = Boolean(pair.partnerTokenHash);
      return {
        pairId: pair.id,
        role,
        status: linked ? 'linked' : 'waiting',
        linkedAt: pair.linkedAt ? new Date(pair.linkedAt).toISOString() : null
      };
    },

    leave(token) {
      const pair = findByToken(token);
      if (!pair) return false;
      pairs = pairs.filter((item) => item !== pair);
      persist();
      return true;
    }
  };
}
