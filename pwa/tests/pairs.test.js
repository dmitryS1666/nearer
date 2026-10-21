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

const TTL = 20 * 60 * 1000;

function serviceAt(store, at, limits) {
  return createPairService(store, { now: () => at, limits });
}

describe('pair store', () => {
  it('links two devices and keeps only hashes on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blizhe-pairs-'));
    const filePath = join(dir, 'pairs.json');
    try {
      const store = createPairStore({ filePath, now: () => 1_000, ttlMs: TTL });
      const created = store.create(1_000);
      const joined = store.join(` ${created.code.slice(0, 3)}-${created.code.slice(3).toLowerCase()} `, 2_000);
      assert.equal(joined.status, 'linked');
      assert.equal(store.me(created.deviceToken, 2_000).role, 'a');
      assert.equal(store.me(joined.deviceToken, 2_000).status, 'linked');
      assert.equal(store.join(created.code, 3_000), null);

      const raw = readFileSync(filePath, 'utf8');
      assert.equal(raw.includes(created.deviceToken), false);
      assert.equal(raw.includes(created.code), false);
      assert.equal(raw.includes(hashSecret(created.deviceToken)), true);

      const reloaded = createPairStore({ filePath, now: () => 4_000, ttlMs: TTL });
      assert.equal(reloaded.me(joined.deviceToken, 4_000).pairId, created.pairId);
      assert.equal(reloaded.leave(created.deviceToken), true);
      assert.equal(reloaded.me(joined.deviceToken, 4_000), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown or expired code the same way', () => {
    const store = createPairStore({ now: () => 0, ttlMs: TTL });
    const created = store.create(0);
    const api = createPairService(store, { now: () => TTL + 1 });
    const expired = api.handle({ method: 'POST', path: '/api/pairs/join', rawBody: JSON.stringify({ code: created.code }) });
    const missing = api.handle({ method: 'POST', path: '/api/pairs/join', rawBody: JSON.stringify({ code: 'ZZZZZZ' }) });
    assert.equal(expired.status, 404);
    assert.deepEqual(expired.json, missing.json);
  });

  it('rate-limits code creation', () => {
    const store = createPairStore();
    const api = createPairService(store, { now: () => 10, limits: { create: 2, join: 2, windowMs: 1000 } });
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', ip: '10.0.0.8' }).status, 201);
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', ip: '10.0.0.8' }).status, 201);
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', ip: '10.0.0.8' }).status, 429);
    assert.equal(api.handle({ method: 'POST', path: '/api/pairs', ip: '10.0.0.9' }).status, 201);
  });

  it('requires the device token for status', () => {
    const store = createPairStore();
    const api = serviceAt(store, 50);
    const created = api.handle({ method: 'POST', path: '/api/pairs' });
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
        role: 'a',
        status: 'linked',
        linkedAt: '2026-10-14T12:00:00.000Z',
        inviteCode: 'ABCDEF',
        inviteExpiresAt: null
      }
    });
    const backup = buildLocalBackup(current, '2026-10-19T12:00:00.000Z');
    assert.equal(JSON.stringify(backup).includes('super-secret-token'), false);
    assert.equal(JSON.stringify(backup).includes('ABCDEF'), false);
    assert.equal(backup.state.history.length, 14);

    const restored = restoreLocalBackup({ deviceLink: current.deviceLink }, backup);
    assert.equal(restored.history[13].answers.a.text, 'Ответ 14');
    assert.equal(restored.answers['2026-10-14'].a.text, 'сегодня');
    assert.equal(restored.streak, 14);
    assert.equal(restored.deviceLink.deviceToken, 'super-secret-token');
    assert.ok(restored.lists.length >= 6);
  });
});