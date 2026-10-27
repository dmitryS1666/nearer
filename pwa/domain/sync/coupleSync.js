import { buildSyncPayload, SYNC_FORMAT_VERSION } from './payload.js';
import { mergeSyncPayload } from './merge.js';
import { deriveSyncKey, encryptJson, decryptJson } from '../../platform/link/pairCrypto.js';
import { fetchPairSync as defaultFetchPairSync, putPairSync as defaultPutPairSync } from '../../platform/link/pairClient.js';

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

function domainSyncError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

/**
 * Pull encrypted snapshot → decrypt → merge → encrypt → push.
 * Server only sees ciphertext + revision.
 * @param {object} [options.transport] optional { fetchPairSync, putPairSync } for tests
 */
export async function runCoupleSync(state, { saveState, transport } = {}) {
  const link = state.deviceLink;
  if (!canSync(link)) return { status: 'skipped' };

  const fetchSync = transport?.fetchPairSync || defaultFetchPairSync;
  const putSync = transport?.putPairSync || defaultPutPairSync;

  const key = await syncCryptoKey(link);
  let remote = await fetchSync(link.deviceToken);
  let revision = remote.revision || 0;

  if (remote.ciphertext && remote.iv) {
    let payload;
    try {
      payload = await decryptJson(key, remote);
    } catch {
      state.deviceLink = { ...state.deviceLink, syncError: 'decrypt_failed' };
      if (saveState) await saveState(state);
      throw domainSyncError('decrypt_failed');
    }
    try {
      state = mergeSyncPayload(state, payload);
    } catch (error) {
      const code = error?.code || 'sync_failed';
      // Do not advance lastSyncAt / syncRevision on domain rejection.
      state.deviceLink = { ...state.deviceLink, syncError: code };
      if (saveState) await saveState(state);
      if (code === 'sync_circle_mismatch' || code === 'client_outdated' || code === 'invalid_sync_payload') {
        throw domainSyncError(code, error.message);
      }
      throw error;
    }
    state.deviceLink = {
      ...state.deviceLink,
      syncRevision: revision,
      lastSyncAt: new Date().toISOString(),
      syncError: null
    };
  }

  // Push local (possibly merged) snapshot.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const encrypted = await encryptJson(key, buildSyncPayload(state));
    try {
      const pushed = await putSync(link.deviceToken, {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        baseRevision: revision,
        formatVersion: SYNC_FORMAT_VERSION
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
        let payload;
        try {
          payload = await decryptJson(key, remote);
        } catch {
          state.deviceLink = { ...state.deviceLink, syncError: 'decrypt_failed' };
          if (saveState) await saveState(state);
          throw domainSyncError('decrypt_failed');
        }
        try {
          state = mergeSyncPayload(state, payload);
        } catch (mergeError) {
          const code = mergeError?.code || 'sync_failed';
          state.deviceLink = { ...state.deviceLink, syncError: code };
          if (saveState) await saveState(state);
          if (code === 'sync_circle_mismatch' || code === 'client_outdated' || code === 'invalid_sync_payload') {
            throw domainSyncError(code, mergeError.message);
          }
          throw mergeError;
        }
        state.deviceLink = { ...state.deviceLink, syncRevision: revision };
      }
    }
  }
  throw domainSyncError('sync_conflict');
}
