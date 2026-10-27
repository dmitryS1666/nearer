import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState, SCHEMA_VERSION } from '../domain/schema.js';
import { emptyDeviceLink, bindStateToPair, rememberBoundPairOnLeave } from '../domain/link.js';
import {
  ORPHAN_CIRCLE,
  currentCircleId,
  getDayAnswers,
  setDayAnswer,
  getDayReaction,
  setDayReaction
} from '../domain/garden/ownership.js';
import { buildSyncPayload, SYNC_FORMAT_VERSION } from '../domain/sync/payload.js';
import { mergeSyncPayload } from '../domain/sync/merge.js';
import { runCoupleSync } from '../domain/sync/coupleSync.js';
import { generatePairIdentity, deriveSyncKey, encryptJson, decryptJson } from '../platform/link/pairCrypto.js';
import { buildLocalBackup, restoreLocalBackup } from '../domain/backup.js';

function linked(state, pairId, role = 'a') {
  state.deviceLink = {
    ...emptyDeviceLink(),
    pairId,
    deviceToken: `tok-${role}`,
    status: 'linked',
    role,
    publicKey: 'x'.repeat(90),
    peerPublicKey: 'y'.repeat(90),
    privateKeyJwk: { kty: 'EC', crv: 'P-256', x: '1', y: '2', d: '3' }
  };
  state.activeCircleId = pairId;
  state.circleId = pairId;
  state.lastBoundPairId = pairId;
  state.currentRole = role;
  return state;
}

describe('REGRESSION: daily answer of previous partner must not enter new pair payload', () => {
  it('same calendar day: new pair payload excludes old partner role; old archive kept', () => {
    const day = '2026-10-27';
    let state = migrateState({
      ...structuredClone(initialState),
      onboarded: true,
      calendarDate: day
    });
    linked(state, 'pair-AB', 'a');
    setDayAnswer(state, day, 'a', { text: 'A for B', submittedAt: '2026-10-27T10:00:00.000Z' });
    setDayAnswer(state, day, 'b', { text: 'OLD PARTNER PRIVATE', submittedAt: '2026-10-27T10:05:00.000Z' });
    setDayReaction(state, day, { value: '❤️', updatedAt: '2026-10-27T10:06:00.000Z' });

    rememberBoundPairOnLeave(state);
    state.deviceLink = emptyDeviceLink();

    // App restart simulation: previousPairId from deviceLink is null
    bindStateToPair(state, 'pair-AC', { previousPairId: null });
    state.currentRole = 'a';
    state.calendarDate = day;

    // New daily answer for role a — must not absorb old b
    setDayAnswer(state, day, 'a', { text: 'A for C', submittedAt: '2026-10-27T12:00:00.000Z' });

    const dayNew = getDayAnswers(state, day);
    assert.equal(dayNew.a?.text, 'A for C');
    assert.equal(dayNew.b?.text, undefined);

    const payload = buildSyncPayload(state);
    assert.equal(payload.circleId, 'pair-AC');
    assert.equal(JSON.stringify(payload.answers).includes('OLD PARTNER PRIVATE'), false);
    assert.equal(JSON.stringify(payload.reactions).includes('❤️') && payload.circleId === 'pair-AC', false);
    // Explicit: payload answers for the day have only a
    const wireDay = payload.answers[day];
    assert.ok(wireDay);
    assert.equal(wireDay.a?.text, 'A for C');
    assert.equal(wireDay.b, undefined);

    // Old archive preserved under pair-AB
    const oldDay = getDayAnswers(state, day, 'pair-AB');
    assert.equal(oldDay.b?.text, 'OLD PARTNER PRIVATE');
    assert.equal(oldDay.a?.text, 'A for B');
    assert.equal(getDayReaction(state, day, 'pair-AB')?.value || getDayReaction(state, day, 'pair-AB'), '❤️');
  });

  it('completeDay is scoped to current circle; same calendarDate allowed for two pairs', () => {
    const day = '2026-10-27';
    let state = migrateState({
      ...structuredClone(initialState),
      onboarded: true,
      calendarDate: day,
      dayIndex: 3
    });
    linked(state, 'pair-AB', 'a');
    state.history = [
      {
        calendarDate: day,
        dayIndex: 3,
        circleId: 'pair-AB',
        question: 'Old',
        answers: { a: { text: 'x' }, b: { text: 'y' } }
      }
    ];
    state.completedDays = 1;
    state.lastCompletedCalendarDate = day;

    rememberBoundPairOnLeave(state);
    state.deviceLink = emptyDeviceLink();
    bindStateToPair(state, 'pair-AC', { previousPairId: null });
    state.calendarDate = day;
    state.dayIndex = 3;
    setDayAnswer(state, day, 'a', { text: 'new-a', submittedAt: day });
    setDayAnswer(state, day, 'b', { text: 'new-b', submittedAt: day });

    // Emulate completeDay guard
    const circle = currentCircleId(state);
    const already = (state.history || []).some(
      (h) => h.circleId === circle && (h.calendarDate === day || h.dayIndex === state.dayIndex)
    );
    assert.equal(already, false, 'old pair history must not block new pair completeDay');

    state.history.push({
      calendarDate: day,
      dayIndex: 3,
      circleId: circle,
      question: 'New',
      answers: structuredClone(getDayAnswers(state, day))
    });
    state.completedDays = (state.completedDays || 0) + 1;

    assert.equal(state.history.filter((h) => h.calendarDate === day).length, 2);
    assert.ok(state.history.some((h) => h.circleId === 'pair-AB'));
    assert.ok(state.history.some((h) => h.circleId === 'pair-AC'));

    // Second complete same circle/day must not add again
    const already2 = (state.history || []).some(
      (h) => h.circleId === circle && (h.calendarDate === day || h.dayIndex === state.dayIndex)
    );
    assert.equal(already2, true);
  });
});

describe('REGRESSION: circle mismatch must abort sync before PUT', () => {
  it('mergeSyncPayload throws sync_circle_mismatch for foreign circle when linked', () => {
    const local = migrateState({ ...structuredClone(initialState), onboarded: true });
    linked(local, 'pair-mine', 'a');
    setDayAnswer(local, '2026-10-27', 'a', { text: 'keep-me', submittedAt: '2026-10-27T10:00:00.000Z' });
    const before = structuredClone(local);

    const remote = buildSyncPayload(linked(migrateState({ ...structuredClone(initialState) }), 'attacker', 'a'));
    remote.circleId = 'attacker';
    remote.answers = { '2026-10-27': { circleId: 'attacker', a: { text: 'evil' } } };

    assert.throws(() => mergeSyncPayload(local, remote), (e) => e.code === 'sync_circle_mismatch');
    assert.equal(getDayAnswers(local, '2026-10-27').a?.text, 'keep-me');
    assert.deepEqual(local.answers, before.answers);
  });

  it('missing circleId on modern payload is rejected when linked', () => {
    const local = migrateState({ ...structuredClone(initialState) });
    linked(local, 'pair-mine', 'a');
    const remote = buildSyncPayload(local);
    delete remote.circleId;
    assert.throws(() => mergeSyncPayload(local, remote), (e) => e.code === 'sync_circle_mismatch');
  });

  it('runCoupleSync: foreign encrypted snapshot → error, no PUT, local unchanged', async () => {
    const alice = await generatePairIdentity();
    const bob = await generatePairIdentity();
    const key = await deriveSyncKey(alice.privateKeyJwk, bob.publicKey);

    const local = migrateState({ ...structuredClone(initialState), onboarded: true });
    linked(local, 'pair-mine', 'a');
    local.deviceLink.privateKeyJwk = alice.privateKeyJwk;
    local.deviceLink.publicKey = alice.publicKey;
    local.deviceLink.peerPublicKey = bob.publicKey;
    local.deviceLink.deviceToken = 'tok-local';
    setDayAnswer(local, '2026-10-27', 'a', { text: 'local-secret', submittedAt: '2026-10-27T10:00:00.000Z' });
    const answersBefore = structuredClone(local.answers);
    const revBefore = local.deviceLink.syncRevision;

    const evilState = migrateState({ ...structuredClone(initialState) });
    linked(evilState, 'pair-other', 'a');
    setDayAnswer(evilState, '2026-10-27', 'a', { text: 'foreign', submittedAt: '2026-10-27T11:00:00.000Z' });
    const evilPayload = buildSyncPayload(evilState);
    evilPayload.circleId = 'pair-other';
    const sealed = await encryptJson(key, evilPayload);

    let putCount = 0;
    let serverCipher = sealed.ciphertext;
    let serverIv = sealed.iv;
    let serverRev = 5;

    const result = await runCoupleSync(local, {
      saveState: async () => {},
      transport: {
        fetchPairSync: async () => ({
          revision: serverRev,
          ciphertext: serverCipher,
          iv: serverIv,
          formatVersion: SYNC_FORMAT_VERSION
        }),
        putPairSync: async () => {
          putCount += 1;
          serverRev += 1;
          return { revision: serverRev };
        }
      }
    }).then(
      (r) => r,
      (e) => e
    );

    assert.equal(result?.code || result?.status, 'sync_circle_mismatch');
    assert.equal(putCount, 0);
    assert.equal(serverCipher, sealed.ciphertext);
    assert.equal(local.deviceLink.syncRevision, revBefore);
    assert.equal(local.deviceLink.lastSyncAt, null);
    assert.equal(local.deviceLink.syncError, 'sync_circle_mismatch');
    assert.deepEqual(local.answers, answersBefore);
  });

  it('runCoupleSync: foreign snapshot after revision conflict → no retry PUT', async () => {
    const alice = await generatePairIdentity();
    const bob = await generatePairIdentity();
    const key = await deriveSyncKey(alice.privateKeyJwk, bob.publicKey);

    const local = migrateState({ ...structuredClone(initialState) });
    linked(local, 'pair-mine', 'a');
    local.deviceLink.privateKeyJwk = alice.privateKeyJwk;
    local.deviceLink.publicKey = alice.publicKey;
    local.deviceLink.peerPublicKey = bob.publicKey;
    local.deviceLink.deviceToken = 'tok';
    local.deviceLink.syncRevision = 1;
    setDayAnswer(local, '2026-10-27', 'a', { text: 'mine', submittedAt: '2026-10-27T10:00:00.000Z' });

    const good = buildSyncPayload(local);
    good.circleId = 'pair-mine';
    const goodSealed = await encryptJson(key, good);

    const evilState = linked(migrateState({ ...structuredClone(initialState) }), 'pair-other', 'a');
    const evil = buildSyncPayload(evilState);
    evil.circleId = 'pair-other';
    const evilSealed = await encryptJson(key, evil);

    let putCount = 0;
    const err = await runCoupleSync(local, {
      saveState: async () => {},
      transport: {
        fetchPairSync: async () => ({
          revision: 1,
          ciphertext: goodSealed.ciphertext,
          iv: goodSealed.iv,
          formatVersion: SYNC_FORMAT_VERSION
        }),
        putPairSync: async () => {
          putCount += 1;
          const conflict = new Error('conflict');
          conflict.code = 'conflict';
          conflict.payload = {
            revision: 2,
            ciphertext: evilSealed.ciphertext,
            iv: evilSealed.iv,
            formatVersion: SYNC_FORMAT_VERSION
          };
          throw conflict;
        }
      }
    }).then(
      (r) => r,
      (e) => e
    );

    assert.equal(err.code, 'sync_circle_mismatch');
    assert.equal(putCount, 1, 'first PUT attempted then conflict; no further PUT');
  });

  it('valid own-pair snapshot still syncs; unsupported version errors without write', async () => {
    const alice = await generatePairIdentity();
    const bob = await generatePairIdentity();
    const key = await deriveSyncKey(alice.privateKeyJwk, bob.publicKey);

    const local = migrateState({ ...structuredClone(initialState) });
    linked(local, 'pair-mine', 'a');
    local.deviceLink.privateKeyJwk = alice.privateKeyJwk;
    local.deviceLink.publicKey = alice.publicKey;
    local.deviceLink.peerPublicKey = bob.publicKey;
    local.deviceLink.deviceToken = 'tok';
    setDayAnswer(local, '2026-10-27', 'a', { text: 'ok', submittedAt: '2026-10-27T10:00:00.000Z' });

    const peer = structuredClone(local);
    setDayAnswer(peer, '2026-10-27', 'b', { text: 'peer', submittedAt: '2026-10-27T11:00:00.000Z' });
    const sealed = await encryptJson(key, buildSyncPayload(peer));

    let putCount = 0;
    const ok = await runCoupleSync(local, {
      saveState: async (s) => Object.assign(local, s),
      transport: {
        fetchPairSync: async () => ({
          revision: 0,
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          formatVersion: SYNC_FORMAT_VERSION
        }),
        putPairSync: async () => {
          putCount += 1;
          return { revision: 1 };
        }
      }
    });
    assert.equal(ok.status, 'ok');
    assert.equal(putCount, 1);
    assert.equal(getDayAnswers(local, '2026-10-27').b?.text, 'peer');

    const future = buildSyncPayload(local);
    future.minClientSyncVersion = SYNC_FORMAT_VERSION + 10;
    future.formatVersion = SYNC_FORMAT_VERSION + 10;
    const futureSealed = await encryptJson(key, future);
    const up = await runCoupleSync(local, {
      saveState: async () => {},
      transport: {
        fetchPairSync: async () => ({
          revision: 1,
          ciphertext: futureSealed.ciphertext,
          iv: futureSealed.iv,
          formatVersion: SYNC_FORMAT_VERSION + 10
        }),
        putPairSync: async () => {
          putCount += 1;
          return { revision: 2 };
        }
      }
    }).then(
      (r) => r,
      (e) => e
    );
    assert.equal(up.code, 'client_outdated');
    assert.equal(putCount, 1, 'no additional PUT after outdated');
  });
});

describe('REGRESSION: legacy leave without lastBoundPairId must not remap archive', () => {
  it('schema v3 after leave: migrate + bind new pair keeps old period circleIds', () => {
    const old = {
      ...structuredClone(initialState),
      schemaVersion: 3,
      circleId: 'pair-old',
      deviceLink: emptyDeviceLink(),
      onboarded: true,
      periods: [
        {
          id: 'p-old',
          circleId: 'pair-old',
          status: 'completed',
          themeId: 'orchid',
          startDate: '2026-01-01',
          timeZone: 'UTC',
          contentSnapshot: { questions: [], name: 'Old', plantType: 'orchid', palette: {} },
          answers: { q1: { a: { text: 'keep' } } },
          challenge: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          version: 1
        }
      ],
      lists: [{ id: 'l1', circleId: 'pair-old', name: 'Old list', type: 'custom' }],
      moments: [{ id: 'm1', circleId: 'pair-old', title: 'Old moment', media: [] }],
      answers: {
        '2026-01-10': { circleId: 'pair-old', a: { text: 'legacy-a' }, b: { text: 'legacy-b' } }
      }
    };
    assert.equal(old.lastBoundPairId == null, true);
    assert.equal(old.activeCircleId == null, true);

    const state = migrateState(structuredClone(old));
    assert.equal(state.schemaVersion, SCHEMA_VERSION);
    bindStateToPair(state, 'pair-new', { previousPairId: null });

    assert.equal(state.periods.find((p) => p.id === 'p-old').circleId, 'pair-old');
    assert.equal(state.lists.find((l) => l.id === 'l1').circleId, 'pair-old');
    assert.equal(state.moments.find((m) => m.id === 'm1').circleId, 'pair-old');
    assert.equal(getDayAnswers(state, '2026-01-10', 'pair-old').b?.text, 'legacy-b');

    const payload = buildSyncPayload(state);
    assert.equal(payload.circleId, 'pair-new');
    assert.equal(payload.periods.some((p) => p.id === 'p-old'), false);
    assert.equal(JSON.stringify(payload).includes('legacy-b'), false);
    assert.equal(JSON.stringify(payload).includes('Old moment'), false);
  });

  it('proven solo space transfers on first pair; unknown orphan does not', () => {
    const solo = migrateState({
      ...structuredClone(initialState),
      schemaVersion: 0,
      onboarded: true
    });
    assert.ok(solo.soloCircleId, 'empty install gets proven solo marker');
    setDayAnswer(solo, '2026-10-01', 'a', { text: 'solo-only', submittedAt: '2026-10-01T12:00:00.000Z' });
    // Unknown legacy-shaped orphan must stay local even on the same device
    solo.answers.__orphan__ = {
      '2020-01-01': { a: { text: 'UNKNOWN_LEGACY' } }
    };

    bindStateToPair(solo, 'pair-first', { previousPairId: null });
    assert.equal(solo.activeCircleId, 'pair-first');
    assert.equal(solo.soloCircleId, null, 'solo marker consumed after transfer');
    const payload = buildSyncPayload(solo);
    assert.ok(JSON.stringify(payload.answers).includes('solo-only'), 'proven solo syncs');
    assert.equal(JSON.stringify(payload).includes('UNKNOWN_LEGACY'), false);
    assert.equal(getDayAnswers(solo, '2020-01-01', ORPHAN_CIRCLE).a?.text, 'UNKNOWN_LEGACY');
  });

  it('old backup restore onto linked new pair does not remap into live pair', () => {
    const live = migrateState({ ...structuredClone(initialState) });
    linked(live, 'pair-C', 'a');

    const oldBackupState = migrateState({
      ...structuredClone(initialState),
      schemaVersion: 3,
      circleId: 'pair-A',
      periods: [
        {
          id: 'bak-p',
          circleId: 'pair-A',
          status: 'paused',
          themeId: 'lavender',
          startDate: '2026-01-01',
          timeZone: 'UTC',
          contentSnapshot: { questions: [], name: 'Bak', plantType: 'lavender', palette: {} },
          answers: {},
          challenge: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          version: 1
        }
      ],
      answers: { '2026-02-02': { circleId: 'pair-A', a: { text: 'backup-secret' } } }
    });
    const backup = buildLocalBackup(oldBackupState);
    const restored = restoreLocalBackup(live, backup);
    assert.equal(restored.deviceLink.pairId, 'pair-C');
    assert.equal(restored.periods.find((p) => p.id === 'bak-p')?.circleId, 'pair-A');
    const payload = buildSyncPayload(restored);
    assert.equal(JSON.stringify(payload).includes('backup-secret'), false);
    assert.equal(payload.periods.some((p) => p.id === 'bak-p'), false);
  });
});

describe('REGRESSION: unknown legacy archive must not join current pair', () => {
  it('A: schema v2 flat answers without circleId stay out of first-pair payload', () => {
    const legacy = {
      schemaVersion: 2,
      onboarded: true,
      deviceLink: emptyDeviceLink(),
      circleId: 'local-circle-v2',
      profile: { name: 'Аня', partnerName: 'Боря' },
      answers: {
        '2024-05-01': { a: { text: 'LEGACY_FLAT_A' }, b: { text: 'LEGACY_FLAT_B' } }
      },
      history: [
        {
          calendarDate: '2024-05-01',
          question: 'Old?',
          answers: { a: { text: 'LEGACY_FLAT_A' }, b: { text: 'LEGACY_FLAT_B' } }
        }
      ],
      reactions: { '2024-05-01': '❤️' },
      moments: [{ id: 'm-leg', title: 'LEGACY_MOMENT', media: [] }],
      lists: [],
      listItems: [],
      periods: []
    };

    const state = migrateState(structuredClone(legacy));
    assert.equal(state.soloCircleId == null, true, 'migration must not invent proven solo');
    assert.equal(getDayAnswers(state, '2024-05-01', ORPHAN_CIRCLE).a?.text, 'LEGACY_FLAT_A');

    bindStateToPair(state, 'pair-brand-new', { previousPairId: null });
    const payload = buildSyncPayload(state);
    assert.equal(payload.circleId, 'pair-brand-new');
    assert.equal(JSON.stringify(payload).includes('LEGACY_FLAT_A'), false);
    assert.equal(JSON.stringify(payload).includes('LEGACY_FLAT_B'), false);
    assert.equal(JSON.stringify(payload).includes('LEGACY_MOMENT'), false);
    assert.equal(getDayAnswers(state, '2024-05-01', ORPHAN_CIRCLE).b?.text, 'LEGACY_FLAT_B');
    assert.ok((state.history || []).some((h) => h.calendarDate === '2024-05-01' && !h.circleId));
    assert.ok((state.moments || []).some((m) => m.id === 'm-leg' && !m.circleId));
  });

  it('B: backup restore then remigrate must not stamp orphan into live pair payload', () => {
    const live = migrateState({ ...structuredClone(initialState), schemaVersion: 0 });
    linked(live, 'pair-live', 'a');

    const rawBackup = {
      kind: 'blizhe-local-backup',
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      state: {
        schemaVersion: 2,
        circleId: 'old-phone',
        onboarded: true,
        answers: {
          '2023-08-08': { a: { text: 'BACKUP_ORPHAN_SECRET' }, b: { text: 'BACKUP_PARTNER' } }
        },
        history: [{ calendarDate: '2023-08-08', question: 'Q?', answers: { a: { text: 'BACKUP_ORPHAN_SECRET' } } }],
        reactions: { '2023-08-08': '🥹' },
        moments: [{ id: 'bak-m', title: 'BACKUP_MOMENT', media: [] }],
        lists: [],
        listItems: [],
        periods: []
      }
    };

    let restored = restoreLocalBackup(live, rawBackup);
    assert.equal(restored.deviceLink.pairId, 'pair-live');
    let payload = buildSyncPayload(restored);
    assert.equal(JSON.stringify(payload).includes('BACKUP_ORPHAN_SECRET'), false, 'clean right after restore');

    // App restart: persist + migrate again while linked
    restored = migrateState(structuredClone(restored));
    payload = buildSyncPayload(restored);
    assert.equal(JSON.stringify(payload).includes('BACKUP_ORPHAN_SECRET'), false, 'still clean after remigrate');
    assert.equal(JSON.stringify(payload).includes('BACKUP_MOMENT'), false);
    assert.equal(getDayAnswers(restored, '2023-08-08', ORPHAN_CIRCLE).a?.text, 'BACKUP_ORPHAN_SECRET');
  });
});
