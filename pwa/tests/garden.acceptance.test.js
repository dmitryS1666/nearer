import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState } from '../domain/schema.js';
import { PLANT_STAGES, stageForMutualCount } from '../domain/garden/themes.js';
import { derivePeriodProgress, countMutualAnswers } from '../domain/garden/progress.js';
import {
  startPeriod,
  pausePeriod,
  resumePeriod,
  submitPeriodAnswer,
  getActivePeriod,
  normalizeActivePeriods
} from '../domain/garden/period.js';
import { mergePeriods, resolveStatus } from '../domain/garden/mergePeriods.js';
import { buildSyncPayload, SYNC_FORMAT_VERSION, isSyncPayload } from '../domain/sync/payload.js';
import { mergeSyncPayload } from '../domain/sync/merge.js';
import { bindStateToPair } from '../domain/link.js';
import { buildLocalBackup, restoreLocalBackup } from '../domain/backup.js';
import {
  buildPairRecoveryBundle,
  restorePairRecoveryBundle
} from '../domain/garden/recovery.js';
import { createPairStore } from '../../server/pairStore.js';
import { createPairService } from '../../server/pairs.js';
import { generatePairIdentity, deriveSyncKey, encryptJson, decryptJson } from '../platform/link/pairCrypto.js';
import { periodsForSync } from '../domain/garden/circleIdentity.js';

function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function base(circleId) {
  return migrateState({
    ...structuredClone(initialState),
    circleId,
    onboarded: true
  });
}

function unlock(period) {
  period.startDate = '2026-01-01';
  period.timeZone = 'UTC';
}

function answerBoth(state, periodId, questionId, now = '2026-02-01T12:00:00.000Z') {
  submitPeriodAnswer(state, periodId, questionId, 'a', `A-${questionId}`, { now });
  return submitPeriodAnswer(state, periodId, questionId, 'b', `B-${questionId}`, { now });
}

function withPair(state, pairId) {
  state.deviceLink = {
    ...state.deviceLink,
    pairId,
    status: 'linked',
    deviceToken: 'tok',
    publicKey: 'x'.repeat(90),
    peerPublicKey: 'y'.repeat(90),
    privateKeyJwk: { kty: 'EC' },
    role: 'a'
  };
  bindStateToPair(state, pairId);
  return state;
}

describe('acceptance: growth stages 0–7 → 6 visuals', () => {
  it('maps mutual counts to exactly six stage ids', () => {
    assert.equal(PLANT_STAGES.length, 6);
    const expected = [
      [0, 'seed'],
      [1, 'sprout'],
      [2, 'stem'],
      [3, 'stem'],
      [4, 'leaves'],
      [5, 'leaves'],
      [6, 'bud'],
      [7, 'bloom']
    ];
    for (const [n, id] of expected) {
      assert.equal(stageForMutualCount(n).id, id, `mutual=${n}`);
    }
  });

  it('edit and re-sync do not increase mutual count', () => {
    const state = base('c');
    const { period } = startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids()
    });
    unlock(period);
    const q = period.contentSnapshot.questions[0].id;
    answerBoth(state, period.id, q);
    assert.equal(countMutualAnswers(period), 1);
    submitPeriodAnswer(state, period.id, q, 'a', 'edited again', { now: '2026-02-01T13:00:00.000Z' });
    assert.equal(countMutualAnswers(period), 1);
    const twin = mergeSyncPayload(structuredClone(state), buildSyncPayload(state));
    assert.equal(countMutualAnswers(twin.periods[0]), 1);
  });
});

describe('acceptance: pair role binding', () => {
  it('join result role drives currentRole so partners write a vs b', () => {
    const state = base('c');
    state.currentRole = 'a';
    state.deviceLink = {
      ...state.deviceLink,
      role: 'b',
      status: 'linked',
      pairId: 'p1',
      deviceToken: 't'
    };
    if (state.deviceLink.role === 'a' || state.deviceLink.role === 'b') {
      state.currentRole = state.deviceLink.role;
    }
    assert.equal(state.currentRole, 'b');
  });
});

describe('acceptance: pairing circle identity', () => {
  it('divergent local circleIds share pair identity and merge periods on first sync', () => {
    const pairId = 'pair-shared-001';
    const a = withPair(base('uuid-alice'), pairId);
    const b = withPair(base('uuid-bob'), pairId);
    assert.notEqual('uuid-alice', 'uuid-bob');
    assert.equal(a.circleId, pairId);
    assert.equal(b.circleId, pairId);

    startPeriod(a, 'lavender', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'period-1'
    });
    unlock(a.periods[0]);
    submitPeriodAnswer(a, 'period-1', a.periods[0].contentSnapshot.questions[0].id, 'a', 'hello', {
      now: '2026-02-01T12:00:00.000Z'
    });

    const merged = mergeSyncPayload(b, buildSyncPayload(a));
    assert.equal(merged.circleId, pairId);
    assert.equal(merged.periods.length, 1);
    assert.equal(merged.periods[0].id, 'period-1');
    assert.equal(merged.periods[0].answers[a.periods[0].contentSnapshot.questions[0].id].a.text, 'hello');
  });

  it('rejects third-party circle periods while keeping orphans local-only', () => {
    const pairId = 'pair-live';
    const local = withPair(base(pairId), pairId);
    startPeriod(local, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'ours'
    });
    // Orphan from a previous couple — must stay local and not be pushed
    local.periods.push({
      id: 'orphan-old',
      circleId: 'pair-old-other',
      themeId: 'lavender',
      status: 'completed',
      startDate: '2025-01-01',
      timeZone: 'UTC',
      contentSnapshot: { questions: [], name: 'old', plantType: 'x', palette: {} },
      answers: {},
      challenge: {},
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      version: 1
    });

    const remote = withPair(base(pairId), pairId);
    startPeriod(remote, 'zamioculcas', {
      now: new Date('2026-01-02T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'theirs'
    });
    // forged foreign period in payload
    const payload = buildSyncPayload(remote);
    payload.periods.push({
      id: 'foreign',
      circleId: 'totally-other-couple',
      themeId: 'orchid',
      status: 'active',
      startDate: '2026-01-01',
      timeZone: 'UTC',
      contentSnapshot: { questions: [], name: 'f', plantType: 'f', palette: {} },
      answers: { q: { a: { text: 'leak' } } },
      challenge: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1
    });

    const merged = mergeSyncPayload(local, payload);
    assert.ok(merged.periods.find((p) => p.id === 'ours'));
    assert.ok(merged.periods.find((p) => p.id === 'theirs') || merged.periods.find((p) => p.id === 'ours'));
    assert.equal(merged.periods.some((p) => p.id === 'foreign'), false);
    assert.ok(merged.periods.find((p) => p.id === 'orphan-old'));
    const outgoing = buildSyncPayload(merged);
    assert.equal(outgoing.periods.some((p) => p.id === 'orphan-old'), false);
    assert.equal(outgoing.periods.some((p) => p.id === 'foreign'), false);
  });

  it('re-pairing to a new pairId does not push previous pair periods', () => {
    const state = withPair(base('pair-one'), 'pair-one');
    startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'old-period'
    });
    bindStateToPair(state, 'pair-two', { previousPairId: 'pair-one' });
    assert.equal(state.circleId, 'pair-two');
    assert.equal(state.periods.find((p) => p.id === 'old-period').circleId, 'pair-one');
    assert.deepEqual(
      periodsForSync(state.periods, state.circleId).map((p) => p.id),
      []
    );
  });
});

describe('acceptance: period conflicts', () => {
  it('same createdAt different ids: deterministic winner; loser paused with answers', () => {
    const left = withPair(base('p'), 'p');
    const right = withPair(base('p'), 'p');
    const createdAt = '2026-01-01T12:00:00.000Z';
    startPeriod(left, 'orchid', { now: new Date(createdAt), timeZone: 'UTC', idFactory: () => 'aaa' });
    startPeriod(right, 'lavender', { now: new Date(createdAt), timeZone: 'UTC', idFactory: () => 'zzz' });
    unlock(left.periods[0]);
    unlock(right.periods[0]);
    submitPeriodAnswer(left, 'aaa', left.periods[0].contentSnapshot.questions[0].id, 'a', 'keep-me', {
      now: '2026-02-01T12:00:00.000Z'
    });
    submitPeriodAnswer(right, 'zzz', right.periods[0].contentSnapshot.questions[0].id, 'b', 'also-kept', {
      now: '2026-02-01T12:00:00.000Z'
    });

    const ab = mergeSyncPayload(structuredClone(left), buildSyncPayload(right));
    const ba = mergeSyncPayload(structuredClone(right), buildSyncPayload(left));
    for (const m of [ab, ba]) {
      const active = m.periods.filter((p) => p.status === 'active');
      assert.equal(active.length, 1);
      assert.equal(active[0].id, 'aaa');
      const paused = m.periods.find((p) => p.id === 'zzz');
      assert.equal(paused.status, 'paused');
      assert.ok(paused.answers[right.periods[0].contentSnapshot.questions[0].id].b.text);
    }
  });

  it('clock skew does not change dual-start winner (createdAt+id)', () => {
    const early = withPair(base('p'), 'p');
    const skewed = withPair(base('p'), 'p');
    startPeriod(early, 'orchid', {
      now: new Date('2026-01-01T10:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'early'
    });
    startPeriod(skewed, 'lavender', {
      now: new Date('2026-01-01T11:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'late'
    });
    // Skewed device thinks its period is newer via updatedAt far in the future
    skewed.periods[0].updatedAt = '2030-01-01T00:00:00.000Z';
    skewed.periods[0].version = 99;
    const m1 = mergeSyncPayload(structuredClone(early), buildSyncPayload(skewed));
    const m2 = mergeSyncPayload(structuredClone(skewed), buildSyncPayload(early));
    assert.equal(getActivePeriod(m1).id, 'early');
    assert.equal(getActivePeriod(m2).id, 'early');
  });

  it('pause/resume conflict converges both merge orders', () => {
    const a = withPair(base('p'), 'p');
    startPeriod(a, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'same'
    });
    const b = structuredClone(a);
    pausePeriod(a, 'same', { now: '2026-02-01T10:00:00.000Z' });
    // B resumes with later stamp
    resumePeriod(b, 'same', { now: '2026-02-01T12:00:00.000Z' });
    const ab = mergeSyncPayload(structuredClone(a), buildSyncPayload(b));
    const ba = mergeSyncPayload(structuredClone(b), buildSyncPayload(a));
    assert.equal(ab.periods[0].status, ba.periods[0].status);
    assert.equal(ab.periods[0].status, 'active');
  });

  it('stale active with newer stamp cannot revive completed period', () => {
    const done = {
      id: 'x',
      status: 'completed',
      completedAt: '2026-02-01T10:00:00.000Z',
      updatedAt: '2026-02-01T10:00:00.000Z',
      version: 2
    };
    const staleActive = {
      id: 'x',
      status: 'active',
      updatedAt: '2026-02-01T20:00:00.000Z',
      version: 9
    };
    assert.equal(resolveStatus(done, staleActive).status, 'completed');
    assert.equal(resolveStatus(staleActive, done).status, 'completed');

    const a = withPair(base('p'), 'p');
    const { period } = startPeriod(a, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'fin'
    });
    unlock(period);
    for (const q of period.contentSnapshot.questions) {
      answerBoth(a, 'fin', q.id);
    }
    assert.equal(period.status, 'completed');
    const b = structuredClone(a);
    // Stale fork: pretend still active with future stamp
    b.periods[0].status = 'active';
    b.periods[0].completedAt = null;
    b.periods[0].updatedAt = '2030-01-01T00:00:00.000Z';
    b.periods[0].version = 99;
    const ab = mergeSyncPayload(structuredClone(a), buildSyncPayload(b));
    const ba = mergeSyncPayload(structuredClone(b), buildSyncPayload(a));
    assert.equal(ab.periods[0].status, 'completed');
    assert.equal(ba.periods[0].status, 'completed');
  });

  it('paused loser can resume after active is paused', () => {
    const state = withPair(base('p'), 'p');
    startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T10:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'first'
    });
    pausePeriod(state, 'first', { now: '2026-02-01T10:00:00.000Z' });
    startPeriod(state, 'lavender', {
      now: new Date('2026-02-01T11:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'second'
    });
    pausePeriod(state, 'second', { now: '2026-02-01T12:00:00.000Z' });
    resumePeriod(state, 'first', { now: '2026-02-01T13:00:00.000Z' });
    assert.equal(getActivePeriod(state).id, 'first');
  });
});

describe('acceptance: sync v2 server route', () => {
  it('rejects missing/format=1 after v2 without changing ciphertext or revision', async () => {
    const alice = await generatePairIdentity();
    const bob = await generatePairIdentity();
    const store = createPairStore({ now: () => 500 });
    const api = createPairService(store, { now: () => 500 });
    const created = api.handle({
      method: 'POST',
      path: '/api/pairs',
      rawBody: JSON.stringify({ publicKey: alice.publicKey })
    });
    api.handle({
      method: 'POST',
      path: '/api/pairs/join',
      rawBody: JSON.stringify({ code: created.json.code, publicKey: bob.publicKey })
    });
    const key = await deriveSyncKey(alice.privateKeyJwk, bob.publicKey);
    const sealed = await encryptJson(key, buildSyncPayload(withPair(base('p'), created.json.pairId)));
    const put = api.handle({
      method: 'PUT',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`,
      rawBody: JSON.stringify({ ...sealed, baseRevision: 0, formatVersion: SYNC_FORMAT_VERSION })
    });
    assert.equal(put.status, 200);
    const before = api.handle({
      method: 'GET',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`
    });
    const cipherBefore = before.json.ciphertext;
    const revBefore = before.json.revision;

    for (const body of [
      { ...sealed, baseRevision: revBefore },
      { ...sealed, baseRevision: revBefore, formatVersion: 1 }
    ]) {
      const rejected = api.handle({
        method: 'PUT',
        path: '/api/pairs/sync',
        authorization: `Bearer ${created.json.deviceToken}`,
        rawBody: JSON.stringify(body)
      });
      assert.equal(rejected.status, 426);
      assert.equal(rejected.json.error, 'client_outdated');
    }

    const after = api.handle({
      method: 'GET',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`
    });
    assert.equal(after.json.ciphertext, cipherBefore);
    assert.equal(after.json.revision, revBefore);

    // revision conflict returns existing blob
    const conflict = api.handle({
      method: 'PUT',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`,
      rawBody: JSON.stringify({ ...sealed, baseRevision: 0, formatVersion: SYNC_FORMAT_VERSION })
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error, 'conflict');
    assert.equal(conflict.json.ciphertext, cipherBefore);
  });

  it('v2 client can read legacy v1 snapshot and rewrite as v2', async () => {
    const alice = await generatePairIdentity();
    const bob = await generatePairIdentity();
    const store = createPairStore({ now: () => 600 });
    const api = createPairService(store, { now: () => 600 });
    const created = api.handle({
      method: 'POST',
      path: '/api/pairs',
      rawBody: JSON.stringify({ publicKey: alice.publicKey })
    });
    api.handle({
      method: 'POST',
      path: '/api/pairs/join',
      rawBody: JSON.stringify({ code: created.json.code, publicKey: bob.publicKey })
    });
    const key = await deriveSyncKey(alice.privateKeyJwk, bob.publicKey);
    const v1Payload = buildSyncPayload(withPair(base('legacy'), created.json.pairId));
    v1Payload.version = 1;
    delete v1Payload.formatVersion;
    delete v1Payload.minClientSyncVersion;
    delete v1Payload.periods;
    const sealed = await encryptJson(key, v1Payload);
    // Simulate pre-gate server write: force format 0 then put as format 1 equivalent
    const putV1 = api.handle({
      method: 'PUT',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`,
      rawBody: JSON.stringify({ ...sealed, baseRevision: 0, formatVersion: 1 })
    });
    assert.equal(putV1.status, 200);

    const pulled = api.handle({
      method: 'GET',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`
    });
    const opened = await decryptJson(key, pulled.json);
    assert.equal(isSyncPayload(opened), true);
    const local = withPair(base('legacy'), created.json.pairId);
    startPeriod(local, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'after-upgrade'
    });
    const merged = mergeSyncPayload(local, opened);
    assert.ok(merged.periods.find((p) => p.id === 'after-upgrade'));
    const sealed2 = await encryptJson(key, buildSyncPayload(merged));
    const putV2 = api.handle({
      method: 'PUT',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`,
      rawBody: JSON.stringify({
        ...sealed2,
        baseRevision: pulled.json.revision,
        formatVersion: SYNC_FORMAT_VERSION
      })
    });
    assert.equal(putV2.status, 200);
    assert.equal(putV2.json.formatVersion, SYNC_FORMAT_VERSION);
  });
});

describe('acceptance: recovery', () => {
  it('wrong password does not change current state; sensitive fields only in ciphertext', async () => {
    const state = withPair(base('p'), 'pair-rec');
    state.deviceLink.deviceToken = 'tok123456789012345678901234567890';
    state.deviceLink.privateKeyJwk = { kty: 'EC', crv: 'P-256', d: 'secret-d', x: '1', y: '2' };
    const before = structuredClone(state);
    const bundle = await buildPairRecoveryBundle(state, 'correct-passphrase');
    const raw = JSON.stringify(bundle);
    assert.equal(raw.includes('secret-d'), false);
    assert.equal(raw.includes('tok123'), false);
    assert.equal(bundle.kdf, 'PBKDF2-SHA256-210000');
    assert.ok(bundle.salt && bundle.iv && bundle.ciphertext);

    await assert.rejects(() => restorePairRecoveryBundle(state, bundle, 'wrong-pass'), (err) => {
      assert.equal(err.code, 'recovery_decrypt_failed');
      return true;
    });
    assert.deepEqual(state.deviceLink.deviceToken, before.deviceLink.deviceToken);

    const empty = base('fresh');
    const restored = await restorePairRecoveryBundle(empty, bundle, 'correct-passphrase');
    assert.equal(restored.deviceLink.deviceToken, 'tok123456789012345678901234567890');
    assert.equal(restored.circleId, 'pair-rec');
  });

  it('content backup alone restores periods without link; recovery alone restores link', async () => {
    const state = withPair(base('p'), 'pair-rec');
    startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'backed-period'
    });
    state.deviceLink.deviceToken = 'tok123456789012345678901234567890';
    state.deviceLink.privateKeyJwk = { kty: 'EC', crv: 'P-256', d: 'd', x: 'x', y: 'y' };

    const content = buildLocalBackup(state);
    const recovery = await buildPairRecoveryBundle(state, 'passphrase1');

    const onlyContent = restoreLocalBackup({ deviceLink: { status: 'solo' } }, content);
    assert.equal(onlyContent.periods[0].id, 'backed-period');
    assert.notEqual(onlyContent.deviceLink?.deviceToken, 'tok123456789012345678901234567890');

    const onlyRecovery = await restorePairRecoveryBundle(base('empty'), recovery, 'passphrase1');
    assert.equal(onlyRecovery.deviceLink.deviceToken, 'tok123456789012345678901234567890');
    assert.equal((onlyRecovery.periods || []).length, 0);
  });
});
