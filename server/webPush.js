import { createECDH, createCipheriv, createDecipheriv, createSign, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hkdf(ikm, salt, info, length) {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

function derToRaw(der, size = 32) {
  let offset = 2;
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
  if (der[offset] !== 0x02) throw new Error('bad_signature');
  const rLen = der[offset + 1];
  let r = der.subarray(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;
  const sLen = der[offset + 1];
  let s = der.subarray(offset + 2, offset + 2 + sLen);
  if (r.length > size) r = r.subarray(r.length - size);
  if (s.length > size) s = s.subarray(s.length - size);
  if (r.length < size) r = Buffer.concat([Buffer.alloc(size - r.length), r]);
  if (s.length < size) s = Buffer.concat([Buffer.alloc(size - s.length), s]);
  return Buffer.concat([r, s]);
}

export function createVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return {
    publicKey: b64url(raw),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

export function vapidAuthorization({ endpoint, subject, publicKey, privateKeyPem }) {
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject || 'mailto:ops@localhost'
  }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = b64url(derToRaw(signer.sign(privateKeyPem)));
  return `vapid t=${header}.${payload}.${signature}, k=${publicKey}`;
}

export function encryptWebPush({ payload, clientPublicKey, authSecret }) {
  const client = Buffer.from(clientPublicKey, 'base64url');
  const auth = Buffer.from(authSecret, 'base64url');
  const local = createECDH('prime256v1');
  local.generateKeys();
  const salt = randomBytes(16);
  const shared = local.computeSecret(client);
  const localPublic = local.getPublicKey();
  const ikm = hkdf(shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), client, localPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([localPublic.length]), localPublic]);
  const record = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([header, encrypted]);
}

export function decryptWebPush({ body, clientPrivateKey, authSecret }) {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const headerLength = 21 + idLen;
  const header = body.subarray(0, headerLength);
  const senderPublic = body.subarray(21, headerLength);
  const encrypted = body.subarray(headerLength);
  const client = createECDH('prime256v1');
  client.setPrivateKey(clientPrivateKey);
  const shared = client.computeSecret(senderPublic);
  const clientPublic = client.getPublicKey();
  const auth = Buffer.from(authSecret, 'base64url');
  const ikm = hkdf(shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, senderPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const tag = encrypted.subarray(encrypted.length - 16);
  const data = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([decipher.update(data), decipher.final()]);
  const split = record.lastIndexOf(2);
  return record.subarray(0, split).toString('utf8');
}

export async function sendWebPush({ subscription, payload, vapid, fetchImpl = fetch, subject }) {
  const body = encryptWebPush({
    payload: JSON.stringify(payload),
    clientPublicKey: subscription.p256dh,
    authSecret: subscription.auth
  });
  const response = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'content-encoding': 'aes128gcm',
      ttl: '86400',
      authorization: vapidAuthorization({
        endpoint: subscription.endpoint,
        subject,
        publicKey: vapid.publicKey,
        privateKeyPem: vapid.privateKeyPem
      })
    },
    body
  });
  if (response.status === 404 || response.status === 410) {
    const error = new Error('gone');
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error('push_failed');
    error.status = response.status;
    throw error;
  }
  return { status: response.status };
}
