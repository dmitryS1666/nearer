/**
 * ECDH P-256 + HKDF + AES-GCM for pair sync.
 * Private keys and derived secrets never leave the device.
 */

function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('crypto_unavailable');
  return api;
}

function bytesToBase64Url(bytes) {
  let bin = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) bin += String.fromCharCode(view[i]);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(view).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const b64 = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const raw = typeof atob === 'function' ? atob(b64 + pad) : Buffer.from(b64 + pad, 'base64').toString('binary');
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function generatePairIdentity() {
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = bytesToBase64Url(await subtle().exportKey('spki', pair.publicKey));
  const privateKeyJwk = await subtle().exportKey('jwk', pair.privateKey);
  return { publicKey, privateKeyJwk };
}

async function importPrivateKey(jwk) {
  return subtle().importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

async function importPeerPublicKey(spkiBase64Url) {
  return subtle().importKey('spki', base64UrlToBytes(spkiBase64Url), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

export async function deriveSyncKey(privateKeyJwk, peerPublicKey) {
  if (!privateKeyJwk || !peerPublicKey) throw new Error('keys_incomplete');
  const privateKey = await importPrivateKey(privateKeyJwk);
  const publicKey = await importPeerPublicKey(peerPublicKey);
  const shared = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const ikm = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('nearer-pair-sync-v1'),
      info: new TextEncoder().encode('aes-gcm-256')
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(syncKey, payload) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await subtle().encrypt({ name: 'AES-GCM', iv }, syncKey, plain);
  return { ciphertext: bytesToBase64Url(cipher), iv: bytesToBase64Url(iv) };
}

export async function decryptJson(syncKey, { ciphertext, iv }) {
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    syncKey,
    base64UrlToBytes(ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}
