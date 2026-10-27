import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const TOKEN_BYTES = 32;
/** P-256 SPKI as base64url is ~120 chars; allow a little headroom. */
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{80,200}$/;
const IV_RE = /^[A-Za-z0-9_-]{16,32}$/;
const CIPHER_RE = /^[A-Za-z0-9_-]+$/;
export const MAX_SYNC_CIPHER_CHARS = 700_000;

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

export function isPairPublicKey(value) {
  return typeof value === 'string' && PUBLIC_KEY_RE.test(value);
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

function peerPublicKeyFor(pair, role) {
  if (role === 'a') return pair.partnerPublicKey || null;
  return pair.creatorPublicKey || null;
}

/**
 * Pairing + opaque encrypted sync blobs only.
 * Plaintext couple data is never accepted or stored.
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
    return (
      pairs.find(
        (pair) =>
          hashesEqual(pair.creatorTokenHash, tokenHash) ||
          (pair.partnerTokenHash && hashesEqual(pair.partnerTokenHash, tokenHash))
      ) || null
    );
  }

  function roleFor(pair, token) {
    const tokenHash = hashSecret(token);
    return hashesEqual(pair.creatorTokenHash, tokenHash) ? 'a' : 'b';
  }

  return {
    create(at = now(), { publicKey } = {}) {
      if (!isPairPublicKey(publicKey)) return { error: 'public_key_required' };
      if (prune(at)) persist();
      const code = makeCode();
      const deviceToken = randomBytes(TOKEN_BYTES).toString('base64url');
      const pair = {
        id: randomBytes(16).toString('hex'),
        codeHash: hashSecret(code),
        expiresAt: at + ttlMs,
        creatorTokenHash: hashSecret(deviceToken),
        partnerTokenHash: null,
        creatorPublicKey: publicKey,
        partnerPublicKey: null,
        syncCiphertext: null,
        syncIv: null,
        syncRevision: 0,
        syncFormatVersion: 0,
        syncUpdatedAt: null,
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
        status: 'waiting',
        publicKey,
        peerPublicKey: null,
        syncRevision: 0
      };
    },

    join(rawCode, at = now(), { publicKey } = {}) {
      if (!isPairPublicKey(publicKey)) return { error: 'public_key_required' };
      if (prune(at)) persist();
      const code = normalizePairCode(rawCode);
      if (code.length !== CODE_LENGTH) return { error: 'code_invalid' };
      const codeHash = hashSecret(code);
      const pair = pairs.find(
        (item) => item.codeHash && hashesEqual(item.codeHash, codeHash) && !item.partnerTokenHash && item.expiresAt > at
      );
      if (!pair) return { error: 'code_invalid' };
      if (pair.creatorPublicKey === publicKey) return { error: 'public_key_reuse' };
      const deviceToken = randomBytes(TOKEN_BYTES).toString('base64url');
      pair.partnerTokenHash = hashSecret(deviceToken);
      pair.partnerPublicKey = publicKey;
      pair.codeHash = null;
      pair.linkedAt = at;
      persist();
      return {
        pairId: pair.id,
        deviceToken,
        role: 'b',
        status: 'linked',
        publicKey,
        peerPublicKey: pair.creatorPublicKey,
        syncRevision: pair.syncRevision || 0,
        linkedAt: new Date(pair.linkedAt).toISOString()
      };
    },

    me(token, at = now()) {
      const pair = findByToken(token);
      if (!pair) return null;
      if (!pair.partnerTokenHash && pair.expiresAt <= at) return null;
      const role = roleFor(pair, token);
      const linked = Boolean(pair.partnerTokenHash);
      return {
        pairId: pair.id,
        role,
        status: linked ? 'linked' : 'waiting',
        linkedAt: pair.linkedAt ? new Date(pair.linkedAt).toISOString() : null,
        peerPublicKey: linked ? peerPublicKeyFor(pair, role) : null,
        syncRevision: pair.syncRevision || 0
      };
    },

    getSync(token, at = now()) {
      const pair = findByToken(token);
      if (!pair) return { error: 'unauthorized' };
      if (!pair.partnerTokenHash) return { error: 'not_linked' };
      if (!pair.partnerTokenHash && pair.expiresAt <= at) return { error: 'unauthorized' };
      return {
        revision: pair.syncRevision || 0,
        ciphertext: pair.syncCiphertext || null,
        iv: pair.syncIv || null,
        formatVersion: pair.syncFormatVersion || 0,
        updatedAt: pair.syncUpdatedAt ? new Date(pair.syncUpdatedAt).toISOString() : null
      };
    },

    putSync(token, body, at = now()) {
      const pair = findByToken(token);
      if (!pair) return { error: 'unauthorized' };
      if (!pair.partnerTokenHash) return { error: 'not_linked' };
      if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_json' };
      const { ciphertext, iv, baseRevision } = body;
      const clientFormat = Number(body.formatVersion);
      const storedFormat = Number(pair.syncFormatVersion) || 0;
      // Old clients omit formatVersion (NaN/0). Once a v2+ snapshot exists, reject downgrades.
      const effectiveClientFormat = Number.isFinite(clientFormat) && clientFormat > 0 ? clientFormat : 1;
      if (storedFormat > 0 && effectiveClientFormat < storedFormat) {
        return {
          error: 'client_outdated',
          formatVersion: storedFormat,
          revision: pair.syncRevision || 0
        };
      }
      if (typeof ciphertext !== 'string' || !CIPHER_RE.test(ciphertext) || ciphertext.length > MAX_SYNC_CIPHER_CHARS) {
        return { error: 'invalid_ciphertext' };
      }
      if (typeof iv !== 'string' || !IV_RE.test(iv)) return { error: 'invalid_iv' };
      const expected = Number(baseRevision);
      if (!Number.isInteger(expected) || expected < 0) return { error: 'invalid_revision' };
      const current = pair.syncRevision || 0;
      if (expected !== current) {
        return {
          error: 'conflict',
          revision: current,
          ciphertext: pair.syncCiphertext || null,
          iv: pair.syncIv || null,
          formatVersion: storedFormat,
          updatedAt: pair.syncUpdatedAt ? new Date(pair.syncUpdatedAt).toISOString() : null
        };
      }
      pair.syncCiphertext = ciphertext;
      pair.syncIv = iv;
      pair.syncRevision = current + 1;
      pair.syncFormatVersion = Math.max(storedFormat, effectiveClientFormat);
      pair.syncUpdatedAt = at;
      persist();
      return {
        revision: pair.syncRevision,
        formatVersion: pair.syncFormatVersion,
        updatedAt: new Date(pair.syncUpdatedAt).toISOString()
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
