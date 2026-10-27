/**
 * Pair recovery: passphrase-wrapped deviceLink secrets.
 * Content backup stays separate and never includes plaintext keys.
 */
import { normalizeDeviceLink, emptyDeviceLink } from '../link.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export const PAIR_RECOVERY_KIND = 'blizhe-pair-recovery';
export const PAIR_RECOVERY_VERSION = 1;

export function canBuildPairRecovery(link) {
  return Boolean(
    link &&
      link.deviceToken &&
      link.privateKeyJwk &&
      link.publicKey &&
      (link.status === 'linked' || link.status === 'waiting')
  );
}

export async function buildPairRecoveryBundle(state, passphrase) {
  const link = state?.deviceLink;
  if (!canBuildPairRecovery(link)) {
    const error = new Error('recovery_unavailable');
    error.code = 'recovery_unavailable';
    throw error;
  }
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    const error = new Error('passphrase_too_short');
    error.code = 'passphrase_too_short';
    throw error;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const payload = {
    pairId: link.pairId,
    deviceToken: link.deviceToken,
    role: link.role,
    status: link.status,
    publicKey: link.publicKey,
    privateKeyJwk: link.privateKeyJwk,
    peerPublicKey: link.peerPublicKey || null,
    syncRevision: link.syncRevision || 0,
    circleId: state.circleId || null
  };
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  return {
    kind: PAIR_RECOVERY_KIND,
    version: PAIR_RECOVERY_VERSION,
    exportedAt: new Date().toISOString(),
    kdf: 'PBKDF2-SHA256-210000',
    salt: b64url(salt),
    iv: b64url(iv),
    ciphertext: b64url(cipher)
  };
}

export async function restorePairRecoveryBundle(currentState, bundle, passphrase) {
  if (!bundle || bundle.kind !== PAIR_RECOVERY_KIND || bundle.version !== PAIR_RECOVERY_VERSION) {
    const error = new Error('invalid_recovery');
    error.code = 'invalid_recovery';
    throw error;
  }
  if (typeof passphrase !== 'string' || !passphrase) {
    const error = new Error('passphrase_required');
    error.code = 'passphrase_required';
    throw error;
  }
  const salt = fromB64url(bundle.salt);
  const iv = fromB64url(bundle.iv);
  const key = await deriveKey(passphrase, salt);
  let opened;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromB64url(bundle.ciphertext));
    opened = JSON.parse(dec.decode(plain));
  } catch {
    const error = new Error('recovery_decrypt_failed');
    error.code = 'recovery_decrypt_failed';
    throw error;
  }
  // Decrypt succeeded — only now mutate a clone (wrong password leaves caller state untouched).
  const next = structuredClone(currentState);
  next.deviceLink = normalizeDeviceLink({
    pairId: opened.pairId,
    deviceToken: opened.deviceToken,
    role: opened.role,
    status: opened.status || 'linked',
    publicKey: opened.publicKey,
    privateKeyJwk: opened.privateKeyJwk,
    peerPublicKey: opened.peerPublicKey,
    syncRevision: opened.syncRevision || 0,
    linkedAt: opened.status === 'linked' || opened.peerPublicKey ? new Date().toISOString() : null
  });
  if (opened.pairId) {
    next.circleId = opened.circleId || opened.pairId;
    next.activeCircleId = opened.pairId;
    next.lastBoundPairId = opened.pairId;
  } else if (opened.circleId) {
    next.circleId = opened.circleId;
    next.activeCircleId = opened.circleId;
  }
  if (next.deviceLink.role === 'a' || next.deviceLink.role === 'b') {
    next.currentRole = next.deviceLink.role;
  }
  if (!next.deviceLink.deviceToken || !next.deviceLink.privateKeyJwk) {
    const error = new Error('recovery_invalid_link');
    error.code = 'recovery_invalid_link';
    throw error;
  }
  return next;
}

export const RECOVERY_LIMITATIONS = {
  contentBackup: 'Восстанавливает архив и периоды, но не ключи связи.',
  pairBundle: 'Восстанавливает deviceToken и ключи того же pair при верной парольной фразе.',
  partnerStillLinked: 'Если bundle есть — sync снова возможен. Без bundle нужна новая пара (leave + create).',
  bothLost: 'Без backup и bundle данные и связь невосстановимы.'
};
