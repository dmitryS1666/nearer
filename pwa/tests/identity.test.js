import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState } from '../domain/schema.js';
import { buildSyncPayload } from '../domain/sync/payload.js';
import { mergeSyncPayload } from '../domain/sync/merge.js';
import { getDayAnswers, setDayAnswer } from '../domain/garden/ownership.js';
import {
  answerColumns,
  reconcileDeviceRole,
  swapDisplayNames,
  localRole
} from '../domain/identity.js';

function phone(role, name, partnerName) {
  const state = migrateState({
    ...structuredClone(initialState),
    onboarded: true,
    circleId: 'pair-1',
    activeCircleId: 'pair-1',
    currentRole: 'a',
    profile: { name, partnerName },
    deviceLink: {
      ...initialState.deviceLink,
      pairId: 'pair-1',
      deviceToken: 'token-token-token-token-token',
      role,
      status: 'linked'
    }
  });
  setDayAnswer(state, '2026-11-24', 'a', { text: 'ответ Ани', submittedAt: '2026-11-24T10:00:00.000Z' });
  setDayAnswer(state, '2026-11-24', 'b', { text: 'ответ Бори', submittedAt: '2026-11-24T11:00:00.000Z' });
  return state;
}

describe('participant display', () => {
  it('shows the local person next to their own slot on both phones', () => {
    const anya = phone('a', 'Аня', 'Боря');
    const borya = phone('b', 'Боря', 'Аня');
    reconcileDeviceRole(anya);
    reconcileDeviceRole(borya);
    const day = '2026-11-24';
    const aCols = answerColumns(anya, getDayAnswers(anya, day));
    const bCols = answerColumns(borya, getDayAnswers(borya, day));
    assert.equal(aCols.mineName, 'Аня');
    assert.equal(aCols.mineText, 'ответ Ани');
    assert.equal(aCols.partnerName, 'Боря');
    assert.equal(aCols.partnerText, 'ответ Бори');
    assert.equal(bCols.mineName, 'Боря');
    assert.equal(bCols.mineText, 'ответ Бори');
    assert.equal(bCols.partnerName, 'Аня');
    assert.equal(bCols.partnerText, 'ответ Ани');
  });

  it('locks the writing role to the device link and does not move answers', () => {
    const state = phone('b', 'Боря', 'Аня');
    state.currentRole = 'a';
    const before = structuredClone(getDayAnswers(state, '2026-11-24'));
    const result = reconcileDeviceRole(state);
    assert.equal(result.changed, true);
    assert.equal(result.movedAnswers, false);
    assert.equal(localRole(state), 'b');
    assert.deepEqual(getDayAnswers(state, '2026-11-24'), before);
  });

  it('swaps display names only, and a later sync does not put answers in the other slot', () => {
    const local = phone('a', 'Боря', 'Аня');
    swapDisplayNames(local);
    assert.equal(local.profile.name, 'Аня');
    assert.equal(local.profile.partnerName, 'Боря');
    assert.equal(local.profile.namesLocked, true);
    assert.equal(getDayAnswers(local, '2026-11-24').a.text, 'ответ Ани');
    const remote = buildSyncPayload(phone('b', 'Боря', 'Аня'));
    const merged = mergeSyncPayload(local, remote);
    assert.equal(merged.profile.name, 'Аня');
    assert.equal(merged.profile.partnerName, 'Боря');
    assert.equal(getDayAnswers(merged, '2026-11-24').a.text, 'ответ Ани');
    assert.equal(getDayAnswers(merged, '2026-11-24').b.text, 'ответ Бори');
  });

  it('still learns the partner name from their phone when labels are not locked', () => {
    const local = phone('a', 'Аня', 'Партнёр');
    const remote = buildSyncPayload(phone('b', 'Боря', 'Аня'));
    const merged = mergeSyncPayload(local, remote);
    assert.equal(merged.profile.name, 'Аня');
    assert.equal(merged.profile.partnerName, 'Боря');
    assert.equal(getDayAnswers(merged, '2026-11-24').a.text, 'ответ Ани');
  });
});
