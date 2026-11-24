import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, migrateState } from '../domain/schema.js';
import { buildSyncPayload } from '../domain/sync/payload.js';
import { getDayAnswers } from '../domain/garden/ownership.js';
import { SYNC_FORMAT_VERSION } from '../domain/sync/payload.js';

describe('0.1.0 state survives 0.2.0 migration', () => {
  it('keeps profile, pair link, keys, answers, garden, lists, moments and drafts out of sync', () => {
    const legacy = {
      schemaVersion: 6,
      onboarded: true,
      profile: { name: 'Дима', partnerName: 'Катя' },
      currentRole: 'a',
      calendarDate: '2026-10-02',
      questionId: 'q-old',
      dayIndex: 4,
      streak: 3,
      completedDays: 3,
      lastCompletedCalendarDate: '2026-10-01',
      circleId: 'circle-old',
      activeCircleId: 'pair-old',
      lastBoundPairId: 'pair-old',
      answers: {
        'pair-old': {
          '2026-10-01': {
            circleId: 'pair-old',
            a: { text: 'мой старый ответ', submittedAt: '2026-10-01T12:00:00.000Z' },
            b: { text: 'ответ Кати', submittedAt: '2026-10-01T12:30:00.000Z' }
          }
        }
      },
      history: [{
        calendarDate: '2026-10-01',
        circleId: 'pair-old',
        question: 'Как прошёл день?',
        answers: {
          a: { text: 'мой старый ответ' },
          b: { text: 'ответ Кати' }
        }
      }],
      reactions: {},
      lists: [{ id: 'list-1', circleId: 'pair-old', type: 'wishlist', title: 'Хотим', updatedAt: '2026-10-01T00:00:00.000Z' }],
      listItems: [{ id: 'item-1', circleId: 'pair-old', listId: 'list-1', title: 'Лампа', updatedAt: '2026-10-01T00:00:00.000Z', version: 1 }],
      moments: [{ id: 'moment-1', circleId: 'pair-old', title: 'Завтрак', body: 'Дома', favorite: true }],
      importantDates: [{ id: 'date-1', circleId: 'pair-old', title: 'Годовщина', month: 6, day: 1 }],
      notificationPrefs: { daily: true, partner: false, reveal: true, streak: false },
      reminderTime: '21:15',
      deviceLink: {
        pairId: 'pair-old',
        deviceToken: 'device-token-0123456789abcd',
        role: 'a',
        status: 'linked',
        publicKey: 'a'.repeat(90),
        privateKeyJwk: { kty: 'EC', crv: 'P-256', d: 'secret-d', x: 'x', y: 'y' },
        peerPublicKey: 'b'.repeat(90),
        syncRevision: 4
      },
      periods: [{
        id: 'period-1',
        circleId: 'pair-old',
        status: 'active',
        contentSnapshot: { name: 'Тепло', plantType: 'Фиалка', questions: [], palette: {} },
        answers: { q1: { a: { text: 'сад А' }, b: { text: 'сад Б' } } },
        challenge: {}
      }]
    };

    const migrated = migrateState(structuredClone(legacy));
    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION >= 7, true);
    assert.equal(migrated.profile.name, 'Дима');
    assert.equal(migrated.profile.partnerName, 'Катя');
    assert.equal(migrated.deviceLink.role, 'a');
    assert.equal(migrated.deviceLink.privateKeyJwk.d, 'secret-d');
    assert.equal(migrated.deviceLink.pairId, 'pair-old');
    assert.equal(getDayAnswers(migrated, '2026-10-01').a.text, 'мой старый ответ');
    assert.equal(getDayAnswers(migrated, '2026-10-01').b.text, 'ответ Кати');
    assert.equal(migrated.periods[0].contentSnapshot.name, 'Тепло');
    assert.equal(migrated.periods[0].answers.q1.a.text, 'сад А');
    assert.equal(migrated.listItems[0].title, 'Лампа');
    assert.equal(migrated.moments[0].title, 'Завтрак');
    assert.equal(migrated.importantDates[0].title, 'Годовщина');
    assert.equal(migrated.notificationPrefs.daily, true);
    assert.equal(migrated.reminderTime, '21:15');
    assert.equal(migrated.analyticsConsent, 'unknown');

    const payload = buildSyncPayload(migrated);
    assert.equal(payload.formatVersion, SYNC_FORMAT_VERSION);
    assert.equal(payload.formatVersion, 3);
    assert.equal(JSON.stringify(payload).includes('secret-d'), false);
    assert.equal(JSON.stringify(payload).includes('draft:'), false);
    assert.equal(payload.answers['2026-10-01'].a.text, 'мой старый ответ');
  });
});
