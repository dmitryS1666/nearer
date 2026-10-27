import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairStore, hashSecret } from '../../server/pairStore.js';
import { createPairService } from '../../server/pairs.js';
import { buildLocalBackup, restoreLocalBackup } from '../domain/backup.js';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState } from '../domain/schema.js';
import { generatePairIdentity, deriveSyncKey, encryptJson, decryptJson } from '../platform/link/pairCrypto.js';

const TTL = 20 * 60 * 1000;
const PUB_A = `pubA${'x'.repeat(90)}`;
const PUB_B = `pubB${'y'.repeat(90)}`;

function serviceAt(store, at, limits) {
  return createPairService(store, { now: () => at, limits });
}

describe('pair store', () => {
  it('links two devices with ECDH public keys and keeps only hashes on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blizhe-pairs-'));
    const filePath = join(dir, 'pairs.json');
    try {
      const store = createPairStore({ filePath, now: () => 1_000, ttlMs: TTL });
      const created = store.create(1_000, { publicKey: PUB_A });
      assert.equal(created.status, 'waiting');
      const joined = store.join(` ${created.code.slice(0, 3)}-${created.code.slice(3).toLowerCase()} `, 2_000, {
        publicKey: PUB_B
      });
      assert.equal(joined.status, 'linked');
      assert.equal(joined.peerPublicKey, PUB_A);
      assert.equal(store.me(created.deviceToken, 2_000).peerPublicKey, PUB_B);
      assert.equal(store.me(joined.deviceToken, 2_000).status, 'linked');
      assert.equal(store.join(created.code, 3_000, { publicKey: PUB_B }).error, 'code_invalid');

      const raw = readFileSync(filePath, 'utf8');
      assert.equal(raw.includes(created.deviceToken), false);
      assert.equal(raw.includes(created.code), false);
      assert.equal(raw.includes(hashSecret(created.deviceToken)), true);
      assert.equal(raw.includes(PUB_A), true);
      assert.equal(raw.includes(PUB_B), true);

      const reloaded = createPairStore({ filePath, now: () => 4_000, ttlMs: TTL });
      assert.equal(reloaded.me(joined.deviceToken, 4_000).pairId, created.pairId);
      assert.equal(reloaded.leave(created.deviceToken), true);
      assert.equal(reloaded.me(joined.deviceToken, 4_000), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores opaque encrypted sync blobs with optimistic concurrency', () => {
    const store = createPairStore({ now: () => 10, ttlMs: TTL });
    const created = store.create(10, { publicKey: PUB_A });
    const joined = store.join(created.code, 11, { publicKey: PUB_B });
    assert.equal(store.getSync(created.deviceToken).revision, 0);
    const iv = 'AAAAAAAAAAAAAAAA';
    const first = store.putSync(joined.deviceToken, {
      ciphertext: 'Y2lwaGVy',
      iv,
      baseRevision: 0
    }, 12);
    assert.equal(first.revision, 1);
    const conflict = store.putSync(created.deviceToken, {
      ciphertext: 'b3RoZXI',
      iv,
      baseRevision: 0
    }, 13);
    assert.equal(conflict.error, 'conflict');
    assert.equal(conflict.revision, 1);
    assert.equal(conflict.ciphertext, 'Y2lwaGVy');
    const second = store.putSync(created.deviceToken, {
      ciphertext: 'bmV4dA',
      iv,
      baseRevision: 1
    }, 14);
    assert.equal(second.revision, 2);
    assert.equal(store.getSync(joined.deviceToken).ciphertext, 'bmV4dA');
  });

  it('rejects create/join without a public key', () => {
    const store = createPairStore();
    assert.equal(store.create(0, {}).error, 'public_key_required');
    const api = createPairService(store);
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', rawBody: '{}' }).status, 400);
  });

  it('rejects an unknown or expired code the same way', () => {
    const store = createPairStore({ now: () => 0, ttlMs: TTL });
    const created = store.create(0, { publicKey: PUB_A });
    const api = createPairService(store, { now: () => TTL + 1 });
    const expired = api.handle({
      method: 'POST',
      path: '/api/pairs/join',
      rawBody: JSON.stringify({ code: created.code, publicKey: PUB_B })
    });
    const missing = api.handle({
      method: 'POST',
      path: '/api/pairs/join',
      rawBody: JSON.stringify({ code: 'ZZZZZZ', publicKey: PUB_B })
    });
    assert.equal(expired.status, 404);
    assert.deepEqual(expired.json, missing.json);
  });

  it('rate-limits code creation', () => {
    const store = createPairStore();
    const api = createPairService(store, { now: () => 10, limits: { create: 2, join: 2, sync: 2, windowMs: 1000 } });
    const body = JSON.stringify({ publicKey: PUB_A });
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', ip: '10.0.0.8', rawBody: body }).status, 201);
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', ip: '10.0.0.8', rawBody: JSON.stringify({ publicKey: PUB_B }) }).status, 201);
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', ip: '10.0.0.8', rawBody: body }).status, 429);
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', ip: '10.0.0.9', rawBody: body }).status, 201);
  });

  it('requires the device token for status', () => {
    const store = createPairStore();
    const api = serviceAt(store, 50);
    const created = api.handle({ method: 'POST', path: '/api/pairs', rawBody: JSON.stringify({ publicKey: PUB_A }) });
    const status = api.handle({
      method: 'GET',
      path: '/api/pairs/me',
      authorization: `Bearer ${created.json.deviceToken}`
    });
    assert.equal(status.json.status, 'waiting');
    assert.equal(api.handle({ method: 'GET', path: '/api/pairs/me' }).status, 401);
    assert.equal(JSON.stringify(status.json).includes(created.json.deviceToken), false);
  });
});

describe('pair crypto', () => {
  it('derives the same AES key on both devices and round-trips JSON', async () => {
    const a = await generatePairIdentity();
    const b = await generatePairIdentity();
    const keyA = await deriveSyncKey(a.privateKeyJwk, b.publicKey);
    const keyB = await deriveSyncKey(b.privateKeyJwk, a.publicKey);
    const sealed = await encryptJson(keyA, { hello: 'secret-answer', n: 1 });
    const opened = await decryptJson(keyB, sealed);
    assert.deepEqual(opened, { hello: 'secret-answer', n: 1 });
    assert.equal(sealed.ciphertext.includes('secret-answer'), false);
  });
});

describe('local backup across an app update', () => {
  it('keeps two weeks of answers and drops the pairing secret', () => {
    const history = Array.from({ length: 14 }, (_, index) => ({
      calendarDate: `2026-10-${String(index + 1).padStart(2, '0')}`,
      question: `Вопрос ${index + 1}`,
      answers: { a: { text: `Ответ ${index + 1}` } }
    }));
    const current = migrateState({
      ...structuredClone(initialState),
      schemaVersion: 1,
      onboarded: true,
      streak: 14,
      history,
      answers: { '2026-10-14': { a: { text: 'сегодня' } } },
      deviceLink: {
        pairId: 'pair-1',
        deviceToken: 'super-secret-token',
        privateKeyJwk: { kty: 'EC', d: 'private-material' },
        role: 'a',
        status: 'linked',
        linkedAt: '2026-10-14T12:00:00.000Z',
        inviteCode: 'ABCDEF',
        inviteExpiresAt: null
      }
    });
    const backup = buildLocalBackup(current, '2026-10-19T12:00:00.000Z');
    assert.equal(JSON.stringify(backup).includes('super-secret-token'), false);
    assert.equal(JSON.stringify(backup).includes('private-material'), false);
    assert.equal(JSON.stringify(backup).includes('ABCDEF'), false);
    assert.equal(backup.state.history.length, 14);

    const restored = restoreLocalBackup({ deviceLink: current.deviceLink }, backup);
    assert.equal(restored.history[13].answers.a.text, 'Ответ 14');
    assert.equal(
      restored.answers?.['pair-1']?.['2026-10-14']?.a?.text ||
        restored.answers?.__orphan__?.['2026-10-14']?.a?.text,
      'сегодня'
    );
    assert.equal(restored.streak, 14);
    assert.equal(restored.deviceLink.deviceToken, 'super-secret-token');
    assert.ok(restored.lists.length >= 6);
  });
});
