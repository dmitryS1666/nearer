import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState, SCHEMA_VERSION } from '../domain/schema.js';
import { emptyDeviceLink, bindStateToPair, rememberBoundPairOnLeave } from '../domain/link.js';
import { startPeriod, getActivePeriod, pausePeriod, resumePeriod, normalizeActivePeriods } from '../domain/garden/period.js';
import { resolveStatus, mergePeriods } from '../domain/garden/mergePeriods.js';
import { buildSyncPayload, SYNC_FORMAT_VERSION } from '../domain/sync/payload.js';
import { mergeSyncPayload } from '../domain/sync/merge.js';
import { restoreLocalBackup, buildLocalBackup } from '../domain/backup.js';
import { adoptPairIdentity } from '../domain/garden/circleIdentity.js';

function base(circleId = 'solo-1') {
  return migrateState({
    ...structuredClone(initialState),
    circleId,
    onboarded: true,
    answers: {
      '2026-01-10': { a: { text: 'old-answer' }, b: { text: 'old-b' } }
    },
    history: [{ calendarDate: '2026-01-10', question: 'Old Q?', answers: { a: { text: 'old-answer' } } }],
    reactions: { '2026-01-10': '❤️' },
    moments: [{ id: 'm-old', title: 'Old moment', media: ['media-old'], favorite: false }],
    mediaAttachments: [{ id: 'media-old', momentId: 'm-old', sourceUrl: 'https://cdn.example/old.jpg' }],
    lists: [{ id: 'l-old', name: 'Old list', type: 'custom', createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1 }],
    listItems: [{ id: 'li-old', listId: 'l-old', title: 'secret wish', createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1 }],
    importantDates: [{ id: 'd-old', title: 'Anniversary', date: '2020-01-01' }],
    domainEvents: [{ id: 'e-old', type: 'MomentCreated', payload: { momentId: 'm-old' } }],
    reservations: [{ id: 'r-old', itemId: 'li-old', createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1 }]
  });
}

function stampAll(state, circleId) {
  for (const key of ['periods', 'lists', 'listItems', 'moments', 'mediaAttachments', 'importantDates', 'domainEvents', 'reservations']) {
    for (const item of state[key] || []) item.circleId = circleId;
  }
  for (const entry of state.history || []) entry.circleId = circleId;
  // Nested answers/reactions (post-migrate): fold every circle bucket into the target.
  const foldDays = (map) => {
    const days = {};
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (const [key, value] of Object.entries(map || {})) {
      if (dateRe.test(key)) {
        const entry = typeof value === 'string' ? { value } : { ...(value || {}) };
        delete entry.circleId;
        days[key] = { ...(days[key] || {}), ...entry };
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      for (const [day, entry] of Object.entries(value)) {
        if (!dateRe.test(day)) continue;
        const slot = typeof entry === 'string' ? { value: entry } : { ...(entry || {}) };
        delete slot.circleId;
        days[day] = { ...(days[day] || {}), ...slot };
      }
    }
    return { [circleId]: days };
  };
  state.answers = foldDays(state.answers);
  state.reactions = foldDays(state.reactions);
}

describe('REGRESSION: leave then new pair must not remap old archive', () => {
  it('leave clears deviceLink but keeps lastBoundPairId; new pair does not absorb old periods/lists', () => {
    const state = base('pair-A');
    state.deviceLink = {
      ...emptyDeviceLink(),
      pairId: 'pair-A',
      deviceToken: 'tok-a',
      status: 'linked',
      role: 'a',
      publicKey: 'x'.repeat(90),
      peerPublicKey: 'y'.repeat(90),
      privateKeyJwk: { kty: 'EC' }
    };
    state.lastBoundPairId = 'pair-A';
    state.activeCircleId = 'pair-A';
    startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'period-A'
    });
    stampAll(state, 'pair-A');

    rememberBoundPairOnLeave(state);
    state.deviceLink = emptyDeviceLink();
    assert.equal(state.lastBoundPairId, 'pair-A');
    assert.equal(state.deviceLink.pairId, null);

    // Simulate app restart: previousPairId from cleared deviceLink is null — must still detect switch via lastBoundPairId
    const previousPairId = state.deviceLink?.pairId || null;
    assert.equal(previousPairId, null);
    bindStateToPair(state, 'pair-B', { previousPairId });
    assert.equal(state.activeCircleId, 'pair-B');
    assert.equal(state.periods.find((p) => p.id === 'period-A').circleId, 'pair-A');
    const payload = buildSyncPayload(state);
    assert.equal(payload.circleId, 'pair-B');
    assert.equal(payload.periods.some((p) => p.id === 'period-A'), false);
    assert.equal(JSON.stringify(payload.answers).includes('old-answer'), false);
    assert.equal(JSON.stringify(payload.history).includes('Old Q'), false);
    assert.equal(JSON.stringify(payload.moments).includes('Old moment'), false);
    assert.equal(JSON.stringify(payload.listItems).includes('secret wish'), false);
    assert.equal(JSON.stringify(payload.mediaAttachments).includes('old.jpg'), false);
    assert.equal(JSON.stringify(payload.importantDates).includes('Anniversary'), false);
    assert.equal(JSON.stringify(payload.domainEvents).includes('m-old'), false);
    assert.equal(JSON.stringify(payload.reservations).includes('r-old'), false);
    // Local archive preserved
    assert.ok(state.periods.find((p) => p.id === 'period-A'));
    assert.ok(state.moments.find((m) => m.id === 'm-old'));
  });

  it('adoptPairIdentity shares the same switch policy as bindStateToPair', () => {
    const state = base('pair-A');
    state.lastBoundPairId = 'pair-A';
    state.activeCircleId = 'pair-A';
    startPeriod(state, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'period-A'
    });
    stampAll(state, 'pair-A');
    adoptPairIdentity(state, 'pair-B', { previousPairId: null });
    assert.equal(state.periods.find((p) => p.id === 'period-A').circleId, 'pair-A');
  });

  it('backup restore while linked to new pair does not remap old archive into live pair', () => {
    const linked = base('pair-C');
    linked.deviceLink = {
      ...emptyDeviceLink(),
      pairId: 'pair-C',
      deviceToken: 'tok-c',
      status: 'linked',
      role: 'a',
      publicKey: 'x'.repeat(90),
      peerPublicKey: 'y'.repeat(90),
      privateKeyJwk: { kty: 'EC' }
    };
    linked.activeCircleId = 'pair-C';
    linked.lastBoundPairId = 'pair-C';

    const old = base('pair-A');
    old.activeCircleId = 'pair-A';
    stampAll(old, 'pair-A');
    const backup = buildLocalBackup(old);
    const restored = restoreLocalBackup(linked, backup);
    assert.equal(restored.deviceLink.pairId, 'pair-C');
    assert.equal(restored.activeCircleId, 'pair-C');
    assert.ok(restored.moments.some((m) => m.id === 'm-old' && m.circleId === 'pair-A'));
    const payload = buildSyncPayload(restored);
    assert.equal(JSON.stringify(payload).includes('Old moment'), false);
    assert.equal(JSON.stringify(payload).includes('secret wish'), false);
  });
});

describe('REGRESSION: status merge order independence', () => {
  it('active vs paused with identical stamps converges regardless of argument order', () => {
    const active = {
      id: 'same',
      status: 'active',
      updatedAt: '2026-02-01T12:00:00.000Z',
      version: 3,
      statusUpdatedAt: '2026-02-01T12:00:00.000Z',
      statusVersion: 3
    };
    const paused = {
      id: 'same',
      status: 'paused',
      updatedAt: '2026-02-01T12:00:00.000Z',
      version: 3,
      statusUpdatedAt: '2026-02-01T12:00:00.000Z',
      statusVersion: 3,
      pausedAt: '2026-02-01T12:00:00.000Z'
    };
    const ab = resolveStatus(active, paused);
    const ba = resolveStatus(paused, active);
    assert.equal(ab.status, ba.status);
  });

  it('content edit does not override a newer status op', () => {
    const paused = {
      id: 'p',
      status: 'paused',
      updatedAt: '2026-02-01T10:00:00.000Z',
      version: 2,
      statusUpdatedAt: '2026-02-01T12:00:00.000Z',
      statusVersion: 5,
      pausedAt: '2026-02-01T12:00:00.000Z'
    };
    const answerEditStillActive = {
      id: 'p',
      status: 'active',
      updatedAt: '2026-02-01T20:00:00.000Z',
      version: 9,
      statusUpdatedAt: '2026-02-01T11:00:00.000Z',
      statusVersion: 4
    };
    assert.equal(resolveStatus(paused, answerEditStillActive).status, 'paused');
    assert.equal(resolveStatus(answerEditStillActive, paused).status, 'paused');
  });

  it('later resume beats earlier pause', () => {
    const paused = {
      id: 'p',
      status: 'paused',
      statusUpdatedAt: '2026-02-01T10:00:00.000Z',
      statusVersion: 2,
      pausedAt: '2026-02-01T10:00:00.000Z'
    };
    const resumed = {
      id: 'p',
      status: 'active',
      statusUpdatedAt: '2026-02-01T12:00:00.000Z',
      statusVersion: 3
    };
    assert.equal(resolveStatus(paused, resumed).status, 'active');
    assert.equal(resolveStatus(resumed, paused).status, 'active');
  });

  it('dual-active normalize is idempotent across repeated merges', () => {
    const state = migrateState({
      ...structuredClone(initialState),
      circleId: 'c',
      activeCircleId: 'c',
      periods: [
        {
          id: 'a',
          circleId: 'c',
          status: 'active',
          createdAt: '2026-01-01T10:00:00.000Z',
          updatedAt: '2026-01-01T10:00:00.000Z',
          version: 1,
          themeId: 'orchid',
          startDate: '2026-01-01',
          timeZone: 'UTC',
          contentSnapshot: { questions: [], name: 'A', plantType: 'a', palette: {} },
          answers: {},
          challenge: {}
        },
        {
          id: 'b',
          circleId: 'c',
          status: 'active',
          createdAt: '2026-01-01T12:00:00.000Z',
          updatedAt: '2026-01-01T12:00:00.000Z',
          version: 1,
          themeId: 'lavender',
          startDate: '2026-01-01',
          timeZone: 'UTC',
          contentSnapshot: { questions: [], name: 'B', plantType: 'b', palette: {} },
          answers: {},
          challenge: {}
        }
      ]
    });
    normalizeActivePeriods(state, { now: '2026-02-01T00:00:00.000Z' });
    const v1 = state.periods.find((p) => p.id === 'b').statusVersion;
    normalizeActivePeriods(state, { now: '2026-02-01T01:00:00.000Z' });
    assert.equal(state.periods.filter((p) => p.status === 'active').length, 1);
    assert.equal(state.periods.find((p) => p.id === 'b').statusVersion, v1);
  });
});

describe('REGRESSION: old active period must not block new pair', () => {
  it('getActivePeriod ignores foreign-circle active periods', () => {
    const state = base('pair-B');
    state.activeCircleId = 'pair-B';
    state.lastBoundPairId = 'pair-B';
    state.periods = [
      {
        id: 'old-active',
        circleId: 'pair-A',
        status: 'active',
        themeId: 'orchid',
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
    assert.equal(getActivePeriod(state), null);
    const started = startPeriod(state, 'lavender', {
      now: new Date('2026-03-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'new-period'
    });
    assert.equal(started.period.id, 'new-period');
    assert.equal(getActivePeriod(state).id, 'new-period');
  });

  it('pause/resume on foreign periodId is rejected', () => {
    const state = base('pair-B');
    state.activeCircleId = 'pair-B';
    state.periods = [
      {
        id: 'foreign',
        circleId: 'pair-A',
        status: 'active',
        themeId: 'orchid',
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
    assert.throws(() => pausePeriod(state, 'foreign'), (e) => e.code === 'period_not_found');
    assert.throws(() => resumePeriod(state, 'foreign'), (e) => e.code === 'period_not_found');
  });
});

describe('REGRESSION: incoming payload circle must match expected pair', () => {
  it('rejects merging when remote circleId is not the bound pair', () => {
    const local = base('pair-B');
    local.activeCircleId = 'pair-B';
    local.lastBoundPairId = 'pair-B';
    local.deviceLink = {
      ...emptyDeviceLink(),
      pairId: 'pair-B',
      deviceToken: 't',
      status: 'linked',
      role: 'a',
      publicKey: 'x'.repeat(90),
      peerPublicKey: 'y'.repeat(90),
      privateKeyJwk: { kty: 'EC' }
    };
    const remoteState = base('attacker');
    remoteState.activeCircleId = 'attacker';
    startPeriod(remoteState, 'orchid', {
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
      idFactory: () => 'evil'
    });
    remoteState.periods[0].circleId = 'attacker';
    const payload = buildSyncPayload(remoteState);
    payload.circleId = 'attacker';
    assert.throws(() => mergeSyncPayload(local, payload), (e) => e.code === 'sync_circle_mismatch');
    assert.equal(local.periods.some((p) => p.id === 'evil'), false);
  });

  it('unscoped legacy entities are not auto-sent', () => {
    const state = migrateState({
      ...structuredClone(initialState),
      circleId: 'pair-B',
      activeCircleId: 'pair-B'
    });
    // Force an unknown-affiliation entity after migration stamp
    state.moments.push({ id: 'orphan', title: 'no circle', media: [] });
    delete state.moments.find((m) => m.id === 'orphan').circleId;
    const payload = buildSyncPayload(state);
    assert.equal(payload.moments.some((m) => m.id === 'orphan'), false);
  });

  it('schema migrates to v4 with affiliation fields', () => {
    const migrated = migrateState({ ...structuredClone(initialState), schemaVersion: 2 });
    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.ok(migrated.activeCircleId);
    assert.equal(SYNC_FORMAT_VERSION, 3);
  });
});
