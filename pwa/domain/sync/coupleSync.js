import { buildSyncPayload } from './payload.js';
import { mergeSyncPayload } from './merge.js';
import { deriveSyncKey, encryptJson, decryptJson } from '../../platform/link/pairCrypto.js';
import { fetchPairSync, putPairSync } from '../../platform/link/pairClient.js';

let cachedKey = null;
let cachedKeyId = '';

function keyCacheId(link) {
  return `${link?.pairId || ''}:${link?.peerPublicKey || ''}:${link?.publicKey || ''}`;
}

async function syncCryptoKey(link) {
  const id = keyCacheId(link);
  if (cachedKey && cachedKeyId === id) return cachedKey;
  cachedKey = await deriveSyncKey(link.privateKeyJwk, link.peerPublicKey);
  cachedKeyId = id;
  return cachedKey;
}

export function clearSyncKeyCache() {
  cachedKey = null;
  cachedKeyId = '';
}

export function canSync(link) {
  return Boolean(
    link?.status === 'linked' &&
      link.deviceToken &&
      link.privateKeyJwk &&
      link.peerPublicKey
  );
}

/**
 * Pull encrypted snapshot → decrypt → merge → encrypt → push.
 * Server only sees ciphertext + revision.
 */
export async function runCoupleSync(state, { saveState } = {}) {
  const link = state.deviceLink;
  if (!canSync(link)) return { status: 'skipped' };

  const key = await syncCryptoKey(link);
  let remote = await fetchPairSync(link.deviceToken);
  let revision = remote.revision || 0;

  if (remote.ciphertext && remote.iv) {
    try {
      const payload = await decryptJson(key, remote);
      state = mergeSyncPayload(state, payload);
      state.deviceLink = {
        ...state.deviceLink,
        syncRevision: revision,
        lastSyncAt: new Date().toISOString(),
        syncError: null
      };
    } catch {
      state.deviceLink = { ...state.deviceLink, syncError: 'decrypt_failed' };
      if (saveState) await saveState(state);
      const error = new Error('decrypt_failed');
      error.code = 'decrypt_failed';
      throw error;
    }
  }

  // Push local (possibly merged) snapshot.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const encrypted = await encryptJson(key, buildSyncPayload(state));
    try {
      const pushed = await putPairSync(link.deviceToken, {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        baseRevision: revision
      });
      state.deviceLink = {
        ...state.deviceLink,
        syncRevision: pushed.revision,
        lastSyncAt: new Date().toISOString(),
        syncError: null
      };
      if (saveState) await saveState(state);
      return { status: 'ok', state, revision: pushed.revision };
    } catch (error) {
      if (error.code !== 'conflict' || !error.payload) throw error;
      remote = error.payload;
      revision = remote.revision || revision;
      if (remote.ciphertext && remote.iv) {
        const payload = await decryptJson(key, remote);
        state = mergeSyncPayload(state, payload);
        state.deviceLink = { ...state.deviceLink, syncRevision: revision };
      }
    }
  }
  const error = new Error('sync_conflict');
  error.code = 'sync_conflict';
  throw error;
}
