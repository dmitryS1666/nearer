import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { assessAndroidUpdate, assessWebUpdate } from '../domain/appUpdate.js';
import { createVapidKeys, decryptWebPush, encryptWebPush } from '../../server/webPush.js';

describe('app update decisions', () => {
  const local = { versionCode: 1, versionName: '0.1.0' };
  const remote = {
    platform: 'android',
    versionName: '0.2.0',
    versionCode: 2,
    minimumSupportedVersionCode: 1,
    downloadUrl: 'https://example.com/app.apk',
    sha256: 'a'.repeat(64),
    releaseNotes: 'Исправлен ввод',
    mandatory: false
  };

  it('offers a newer signed-looking android build and ignores a bad hash', () => {
    assert.equal(assessAndroidUpdate(local, remote).action, 'available');
    assert.equal(assessAndroidUpdate(local, { ...remote, sha256: 'nope' }).reason, 'bad_sha');
    assert.equal(assessAndroidUpdate(local, { ...remote, versionCode: 1 }).action, 'current');
    assert.equal(assessAndroidUpdate({ versionCode: 1 }, { ...remote, minimumSupportedVersionCode: 2 }).mandatory, true);
  });

  it('does not treat a web update as an apk download', () => {
    assert.equal(assessWebUpdate(local, { ...remote, platform: 'web', downloadUrl: '' }).action, 'available');
    assert.equal(assessAndroidUpdate(local, { ...remote, platform: 'web' }).action, 'none');
  });
});

describe('web push payload', () => {
  it('round-trips a notification without putting it in the clear header', () => {
    const client = createECDH('prime256v1');
    client.generateKeys();
    const auth = randomBytes(16).toString('base64url');
    const body = encryptWebPush({
      payload: JSON.stringify({ title: 'Ближе', body: 'Доступно обновление' }),
      clientPublicKey: client.getPublicKey().toString('base64url'),
      authSecret: auth
    });
    const text = decryptWebPush({ body, clientPrivateKey: client.getPrivateKey(), authSecret: auth });
    assert.equal(JSON.parse(text).title, 'Ближе');
    assert.equal(body.subarray(0, 16).toString('utf8').includes('Ближе'), false);
    const keys = createVapidKeys();
    assert.equal(keys.publicKey.length > 40, true);
    assert.equal(keys.privateKeyPem.includes('PRIVATE KEY'), true);
  });
});
