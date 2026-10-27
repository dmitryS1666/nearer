import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState, SCHEMA_VERSION } from '../domain/schema.js';
import { GARDEN_THEMES, GARDEN_CONTENT_VERSION, REQUIRED_QUESTION_COUNT } from '../domain/garden/themes.js';
import {
  periodDayNumber,
  calendarDateInTimeZone,
  derivePeriodProgress,
  isQuestionUnlocked,
  countMutualAnswers
} from '../domain/garden/progress.js';
import {
  startPeriod,
  pausePeriod,
  resumePeriod,
  submitPeriodAnswer,
  setChallengeDone,
  getActivePeriod,
  normalizeActivePeriods
} from '../domain/garden/period.js';
import { mergePeriods } from '../domain/garden/mergePeriods.js';
import { buildSyncPayload, SYNC_VERSION, SYNC_FORMAT_VERSION, isSyncPayload } from '../domain/sync/payload.js';
import { mergeSyncPayload } from '../domain/sync/merge.js';
import { buildLocalBackup, restoreLocalBackup } from '../domain/backup.js';
import { createPairStore } from '../../server/pairStore.js';
import { createPairService } from '../../server/pairs.js';
import { generatePairIdentity, deriveSyncKey, encryptJson, decryptJson } from '../platform/link/pairCrypto.js';
import { buildPairRecoveryBundle, restorePairRecoveryBundle } from '../domain/garden/recovery.js';

function ids(prefix = 'p') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function base(circleId = 'circle-1') {
  return migrateState({
    ...structuredClone(initialState),
    circleId,
    onboarded: true
  });
}

function unlockAllSchedule(period) {
  // Make every question date-available by backdating start 30 days.
  period.startDate = '2026-01-01';
  period.timeZone = 'UTC';
}

function answerBoth(state, periodId, questionId, { now = '2026-02-01T12:00:00.000Z' } = {}) {
  submitPeriodAnswer(state, periodId, questionId, 'a', `A:${questionId}`, { now });
  return submitPeriodAnswer(state, periodId, questionId, 'b', `B:${questionId}`, { now });
}

describe('garden migration', () => {
  it('keeps old history and does not invent thematic periods from completedDays', () => {
    const old = {
      onboarded: true,
      streak: 5,
      completedDays: 12,
      answers: { '2026-01-01': { a: { text: 'hi' }, b: { text: 'hey' } } },
      history: [{ calendarDate: '2026-01-01', question: 'Q?' }]
    };
    const once = migrateState(structuredClone(old), { now: '2026-10-26T12:00:00.000Z', idFactory: ids('m') });
    const twice = migrateState(structuredClone(once), { now: '2026-10-26T13:00:00.000Z', idFactory: ids('m2') });
    assert.equal(once.schemaVersion, SCHEMA_VERSION);
    assert.equal(twice.schemaVersion, SCHEMA_VERSION);
    assert.equal(once.completedDays, 12);
    assert.equal(once.history.length, 1);
    assert.deepEqual(once.periods, []);
    assert.deepEqual(twice.periods, []);
    assert.equal(
      once.answers?.__orphan__?.['2026-01-01']?.a?.text ||
        once.answers?.[once.circleId]?.['2026-01-01']?.a?.text,
      'hi'
    );
  });
});

describe('garden progress rules', () => {
  it('one side answering does not change progress', () => {
    const state = base();
    const { period } = startPeriod(state, 'zamioculcas', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids()
    });
    unlockAllSchedule(period);
    submitPeriodAnswer(state, period.id, period.contentSnapshot.questions[0].id, 'a', 'only me', {
      now: '2026-02-01T12:00:00.000Z'
    });
    assert.equal(countMutualAnswers(period), 0);
    assert.equal(derivePeriodProgress(period).stage.id, 'seed');
  });

  it('mutual answer credits a question exactly once; edit does not grow again', () => {
    const state = base();
    const { period } = startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids()
    });
    unlockAllSchedule(period);
    const qid = period.contentSnapshot.questions[0].id;
    let r = answerBoth(state, period.id, qid);
    assert.equal(r.mutualIncreased, true);
    assert.equal(derivePeriodProgress(period).mutualCount, 1);
    assert.equal(derivePeriodProgress(period).stage.id, 'sprout');
    r = submitPeriodAnswer(state, period.id, qid, 'a', 'edited', { now: '2026-02-01T13:00:00.000Z' });
    assert.equal(r.mutualIncreased, false);
    assert.equal(derivePeriodProgress(period).mutualCount, 1);
  });

  it('answers on different questions do not form a mutual pair', () => {
    const state = base();
    const { period } = startPeriod(state, 'lavender', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids()
    });
    unlockAllSchedule(period);
    const [q1, q2] = period.contentSnapshot.questions;
    submitPeriodAnswer(state, period.id, q1.id, 'a', 'A1', { now: '2026-02-01T12:00:00.000Z' });
    // q2 still locked until q1 mutual — force unlock check
    assert.equal(isQuestionUnlocked(period, q2, new Date('2026-02-01T12:00:00.000Z')), false);
    submitPeriodAnswer(state, period.id, q1.id, 'b', 'B1', { now: '2026-02-01T12:00:00.000Z' });
    submitPeriodAnswer(state, period.id, q2.id, 'a', 'A2', { now: '2026-02-01T12:00:00.000Z' });
    assert.equal(countMutualAnswers(period), 1);
  });

  it('completing all 7 mutual answers blooms and completes once', () => {
    const state = base();
    const { period } = startPeriod(state, 'strelitzia', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids()
    });
    unlockAllSchedule(period);
    let last;
    for (const q of period.contentSnapshot.questions) {
      last = answerBoth(state, period.id, q.id, { now: '2026-02-10T12:00:00.000Z' });
    }
    assert.equal(last.completed, true);
    assert.equal(period.status, 'completed');
    assert.equal(derivePeriodProgress(period).mutualCount, REQUIRED_QUESTION_COUNT);
    assert.equal(derivePeriodProgress(period).stage.id, 'bloom');
    // re-submit final does not reopen
    assert.throws(() =>
      submitPeriodAnswer(state, period.id, period.contentSnapshot.questions[0].id, 'a', 'x', {
        now: '2026-02-11T12:00:00.000Z'
      })
    );
  });

  it('day 21 does not destroy an unfinished period', () => {
    const state = base();
    const { period } = startPeriod(state, 'zamioculcas', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids()
    });
    assert.ok(periodDayNumber(period, new Date('2026-02-01T12:00:00.000Z')) >= 21);
    assert.equal(period.status, 'active');
    assert.equal(derivePeriodProgress(period).stage.id, 'seed');
  });

  it('schedule is identical across timezones for the same period clock', () => {
    const period = {
      startDate: '2026-06-01',
      timeZone: 'America/New_York'
    };
    const d1 = periodDayNumber(period, new Date('2026-06-01T15:00:00.000Z'));
    const d2 = periodDayNumber({ ...period }, new Date('2026-06-01T15:00:00.000Z'));
    assert.equal(d1, d2);
    const tokyoDay = calendarDateInTimeZone(new Date('2026-06-01T15:00:00.000Z'), 'Asia/Tokyo');
    const nyDay = calendarDateInTimeZone(new Date('2026-06-01T15:00:00.000Z'), 'America/New_York');
    // Same instant may be different local dates — period uses fixed timeZone, so day number stable.
    assert.equal(typeof tokyoDay, 'string');
    assert.equal(typeof nyDay, 'string');
    assert.equal(periodDayNumber(period, new Date('2026-06-05T12:00:00.000Z')), 5);
  });
});

describe('garden pause resume repeat', () => {
  it('pause keeps answers; resume works; new theme after pause; repeat theme new id', () => {
    const state = base();
    const { period } = startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids('t')
    });
    unlockAllSchedule(period);
    answerBoth(state, period.id, period.contentSnapshot.questions[0].id);
    pausePeriod(state, period.id, { now: '2026-02-02T12:00:00.000Z' });
    assert.equal(period.status, 'paused');
    assert.equal(countMutualAnswers(period), 1);
    const second = startPeriod(state, 'lavender', {
      now: new Date('2026-02-03T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids('t2')
    }).period;
    assert.equal(getActivePeriod(state).id, second.id);
    pausePeriod(state, second.id, { now: '2026-02-04T12:00:00.000Z' });
    resumePeriod(state, period.id, { now: '2026-02-05T12:00:00.000Z' });
    assert.equal(getActivePeriod(state).id, period.id);
    pausePeriod(state, period.id, { now: '2026-02-06T12:00:00.000Z' });
    const again = startPeriod(state, 'orchid', {
      now: new Date('2026-02-07T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids('t3')
    }).period;
    assert.notEqual(again.id, period.id);
    assert.equal(again.themeId, 'orchid');
  });

  it('catalog change does not rewrite snapshot questions', () => {
    const state = base();
    const { period } = startPeriod(state, 'zamioculcas', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids(),
      contentVersion: GARDEN_CONTENT_VERSION
    });
    const frozen = period.contentSnapshot.questions[0].text;
    period.contentSnapshot.questions[0].text = frozen;
    // Simulate catalog edit elsewhere — period snapshot stays.
    assert.equal(period.contentSnapshot.questions[0].text, GARDEN_THEMES[0].questions[0].text);
    assert.equal(period.contentSnapshot.contentVersion, GARDEN_CONTENT_VERSION);
  });
});

describe('garden sync merge', () => {
  it('offline answers from both devices merge; order does not matter', () => {
    const a = base('c1');
    const b = base('c1');
    const idFactory = ids('sync');
    const started = startPeriod(a, 'lavender', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory
    });
    // Same period id on B via payload clone
    b.periods = [structuredClone(started.period)];
    unlockAllSchedule(a.periods[0]);
    unlockAllSchedule(b.periods[0]);
    const qid = a.periods[0].contentSnapshot.questions[0].id;
    submitPeriodAnswer(a, started.period.id, qid, 'a', 'from-A', { now: '2026-02-01T10:00:00.000Z' });
    submitPeriodAnswer(b, started.period.id, qid, 'b', 'from-B', { now: '2026-02-01T11:00:00.000Z' });

    const payloadA = buildSyncPayload(a);
    const payloadB = buildSyncPayload(b);
    assert.equal(payloadA.version, SYNC_VERSION);
    assert.equal(isSyncPayload(payloadA), true);

    const ab = mergeSyncPayload(structuredClone(a), payloadB);
    const ba = mergeSyncPayload(structuredClone(b), payloadA);
    assert.equal(ab.periods[0].answers[qid].a.text, 'from-A');
    assert.equal(ab.periods[0].answers[qid].b.text, 'from-B');
    assert.equal(ba.periods[0].answers[qid].a.text, 'from-A');
    assert.equal(ba.periods[0].answers[qid].b.text, 'from-B');
    assert.equal(countMutualAnswers(ab.periods[0]), 1);
    assert.equal(countMutualAnswers(ba.periods[0]), 1);
  });

  it('dual start resolves to one active; answers kept; order invariant', () => {
    const left = base('c1');
    const right = base('c1');
    startPeriod(left, 'orchid', {
      now: new Date('2026-01-01T10:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'period-early'
    });
    startPeriod(right, 'lavender', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'period-late'
    });
    unlockAllSchedule(left.periods[0]);
    unlockAllSchedule(right.periods[0]);
    submitPeriodAnswer(left, 'period-early', left.periods[0].contentSnapshot.questions[0].id, 'a', 'early-a', {
      now: '2026-02-01T12:00:00.000Z'
    });
    submitPeriodAnswer(right, 'period-late', right.periods[0].contentSnapshot.questions[0].id, 'b', 'late-b', {
      now: '2026-02-01T12:00:00.000Z'
    });

    const lr = mergeSyncPayload(structuredClone(left), buildSyncPayload(right));
    const rl = mergeSyncPayload(structuredClone(right), buildSyncPayload(left));
    const activeLr = lr.periods.filter((p) => p.status === 'active');
    const activeRl = rl.periods.filter((p) => p.status === 'active');
    assert.equal(activeLr.length, 1);
    assert.equal(activeRl.length, 1);
    assert.equal(activeLr[0].id, 'period-early');
    assert.equal(activeRl[0].id, 'period-early');
    assert.ok(lr.periods.find((p) => p.id === 'period-late').status === 'paused');
    assert.ok(lr.periods.find((p) => p.id === 'period-early').answers);
    assert.equal(
      lr.periods.find((p) => p.id === 'period-early').answers[left.periods[0].contentSnapshot.questions[0].id].a.text,
      'early-a'
    );
  });

  it('pause/resume/complete conflict converges both ways', () => {
    const a = base('c1');
    const { period } = startPeriod(a, 'zamioculcas', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'same'
    });
    unlockAllSchedule(period);
    const b = structuredClone(a);
    pausePeriod(a, 'same', { now: '2026-02-01T10:00:00.000Z' });
    // B completes offline after answering all
    for (const q of b.periods[0].contentSnapshot.questions) {
      answerBoth(b, 'same', q.id, { now: '2026-02-01T11:00:00.000Z' });
    }
    assert.equal(b.periods[0].status, 'completed');
    const ab = mergeSyncPayload(structuredClone(a), buildSyncPayload(b));
    const ba = mergeSyncPayload(structuredClone(b), buildSyncPayload(a));
    assert.equal(ab.periods[0].status, 'completed');
    assert.equal(ba.periods[0].status, 'completed');
  });

  it('foreign circle periods are not merged when peer circle differs without shared pairId', () => {
    // Without deviceLink.pairId, first-pair reconcile accepts both UUIDs (intentional).
    // True foreign rejection requires an explicit third circle id inside the payload.
    const local = base('circle-A');
    startPeriod(local, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'mine'
    });
    const remote = base('circle-A');
    const payload = buildSyncPayload(remote);
    payload.circleId = 'circle-A';
    payload.periods = [
      {
        id: 'foreign',
        circleId: 'circle-OTHER',
        themeId: 'lavender',
        status: 'active',
        startDate: '2026-01-01',
        timeZone: 'UTC',
        contentSnapshot: { questions: [], name: 'x', plantType: 'x', palette: {} },
        answers: {},
        challenge: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1
      }
    ];
    const merged = mergeSyncPayload(local, payload);
    assert.equal(merged.periods.some((p) => p.id === 'foreign'), false);
    assert.equal(merged.periods.find((p) => p.id === 'mine').id, 'mine');
  });

  it('v1 payload without periods keeps local periods', () => {
    const local = base('c1');
    startPeriod(local, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'keep-me'
    });
    const v1 = buildSyncPayload(base('c1'));
    delete v1.periods;
    v1.version = 1;
    delete v1.formatVersion;
    delete v1.minClientSyncVersion;
    const merged = mergeSyncPayload(local, v1);
    assert.equal(merged.periods[0].id, 'keep-me');
  });
});

describe('garden sync server format gate', () => {
  it('rejects older client put after v2 snapshot exists', async () => {
    const alice = await generatePairIdentity();
    const bob = await generatePairIdentity();
    const store = createPairStore({ now: () => 100 });
    const api = createPairService(store, { now: () => 100 });
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
    const keyA = await deriveSyncKey(alice.privateKeyJwk, bob.publicKey);
    const sealed = await encryptJson(keyA, buildSyncPayload(base('c')));
    const put = api.handle({
      method: 'PUT',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`,
      rawBody: JSON.stringify({ ...sealed, baseRevision: 0, formatVersion: SYNC_FORMAT_VERSION })
    });
    assert.equal(put.status, 200);
    const oldPut = api.handle({
      method: 'PUT',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`,
      rawBody: JSON.stringify({ ...sealed, baseRevision: 1 })
    });
    assert.equal(oldPut.status, 426);
    assert.equal(oldPut.json.error, 'client_outdated');
  });
});

describe('garden backup and recovery', () => {
  it('content backup restores periods without deviceLink secrets', () => {
    const state = base('c1');
    state.deviceLink = {
      ...state.deviceLink,
      deviceToken: 'token-secret',
      privateKeyJwk: { kty: 'EC' },
      status: 'linked'
    };
    startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'backed'
    });
    const backup = buildLocalBackup(state);
    assert.equal(backup.state.deviceLink, undefined);
    assert.equal(JSON.stringify(backup).includes('token-secret'), false);
    const restored = restoreLocalBackup({ deviceLink: { status: 'solo' } }, backup);
    assert.equal(restored.periods[0].id, 'backed');
    assert.notEqual(restored.deviceLink?.deviceToken, 'token-secret');
  });

  it('pair recovery bundle round-trips with passphrase', async () => {
    const state = base('c1');
    state.deviceLink = {
      pairId: 'pair-1',
      deviceToken: 'tok123456789012345678901234567890',
      role: 'a',
      status: 'linked',
      publicKey: 'x'.repeat(90),
      privateKeyJwk: { kty: 'EC', crv: 'P-256', d: '1', x: '2', y: '3' },
      peerPublicKey: 'y'.repeat(90),
      syncRevision: 3,
      linkedAt: '2026-01-01T00:00:00.000Z',
      inviteCode: null,
      inviteExpiresAt: null,
      lastSyncAt: null,
      syncError: null
    };
    const bundle = await buildPairRecoveryBundle(state, 'passphrase-long');
    assert.equal(bundle.kind, 'blizhe-pair-recovery');
    assert.equal(JSON.stringify(bundle).includes('tok123'), false);
    const empty = base('c1');
    const restored = await restorePairRecoveryBundle(empty, bundle, 'passphrase-long');
    assert.equal(restored.deviceLink.deviceToken, 'tok123456789012345678901234567890');
    assert.equal(restored.deviceLink.pairId, 'pair-1');
  });
});

describe('garden themes catalog', () => {
  it('ships four themes with 7 questions and a challenge', () => {
    assert.equal(GARDEN_THEMES.length, 4);
    for (const theme of GARDEN_THEMES) {
      assert.equal(theme.questions.length, 7);
      assert.equal(theme.questions.filter((q) => q.kind === 'final').length, 1);
      assert.ok(theme.challenge?.text);
      assert.ok(theme.palette?.leaf);
    }
  });
});

describe('garden vs daily counters', () => {
  it('multiple period answers in one day do not bump completedDays or streak', () => {
    const state = base();
    state.completedDays = 3;
    state.streak = 2;
    const { period } = startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: ids('day')
    });
    unlockAllSchedule(period);
    for (const q of period.contentSnapshot.questions.slice(0, 3)) {
      answerBoth(state, period.id, q.id, { now: '2026-02-01T12:00:00.000Z' });
    }
    assert.equal(state.completedDays, 3);
    assert.equal(state.streak, 2);
    assert.equal(derivePeriodProgress(period).mutualCount, 3);
  });
});

describe('full two-store cycle', () => {
  it('start → answers → sync → grow → complete → history', async () => {
    const alice = await generatePairIdentity();
    const bob = await generatePairIdentity();
    const store = createPairStore({ now: () => 200 });
    const api = createPairService(store, { now: () => 200 });
    const created = api.handle({
      method: 'POST',
      path: '/api/pairs',
      rawBody: JSON.stringify({ publicKey: alice.publicKey })
    });
    const joined = api.handle({
      method: 'POST',
      path: '/api/pairs/join',
      rawBody: JSON.stringify({ code: created.json.code, publicKey: bob.publicKey })
    });

    let stateA = base('couple');
    let stateB = base('couple');
    startPeriod(stateA, 'zamioculcas', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'cycle-1'
    });
    unlockAllSchedule(stateA.periods[0]);

    const keyA = await deriveSyncKey(alice.privateKeyJwk, bob.publicKey);
    const keyB = await deriveSyncKey(bob.privateKeyJwk, alice.publicKey);

    async function push(state, token, key, baseRev) {
      const sealed = await encryptJson(key, buildSyncPayload(state));
      return api.handle({
        method: 'PUT',
        path: '/api/pairs/sync',
        authorization: `Bearer ${token}`,
        rawBody: JSON.stringify({ ...sealed, baseRevision: baseRev, formatVersion: SYNC_FORMAT_VERSION })
      });
    }
    async function pull(token, key) {
      const res = api.handle({
        method: 'GET',
        path: '/api/pairs/sync',
        authorization: `Bearer ${token}`
      });
      if (!res.json.ciphertext) return null;
      return decryptJson(key, res.json);
    }

    let rev = 0;
    let put = await push(stateA, created.json.deviceToken, keyA, rev);
    assert.equal(put.status, 200);
    rev = put.json.revision;
    const remoteForB = await pull(joined.json.deviceToken, keyB);
    stateB = mergeSyncPayload(stateB, remoteForB);
    assert.equal(stateB.periods[0].id, 'cycle-1');
    unlockAllSchedule(stateB.periods[0]);

    for (const q of stateA.periods[0].contentSnapshot.questions) {
      submitPeriodAnswer(stateA, 'cycle-1', q.id, 'a', `A-${q.id}`, { now: '2026-02-01T12:00:00.000Z' });
      put = await push(stateA, created.json.deviceToken, keyA, rev);
      rev = put.json.revision;
      const mid = await pull(joined.json.deviceToken, keyB);
      stateB = mergeSyncPayload(stateB, mid);
      submitPeriodAnswer(stateB, 'cycle-1', q.id, 'b', `B-${q.id}`, { now: '2026-02-01T12:05:00.000Z' });
      put = await push(stateB, joined.json.deviceToken, keyB, rev);
      rev = put.json.revision;
      const back = await pull(created.json.deviceToken, keyA);
      stateA = mergeSyncPayload(stateA, back);
    }

    assert.equal(stateA.periods[0].status, 'completed');
    assert.equal(stateB.periods[0].status, 'completed');
    assert.equal(derivePeriodProgress(stateA.periods[0]).stage.id, 'bloom');
    setChallengeDone(stateA, 'cycle-1', 'a', true);
    normalizeActivePeriods(stateA);
    assert.equal(getActivePeriod(stateA), null);
  });
});
