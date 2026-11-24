import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftKey,
  legacyDailyDraftKey,
  backgroundRenderWouldDismissKeyboard,
  createDraftController
} from '../domain/drafts.js';

describe('answer drafts', () => {
  it('builds a stable key from pair, role, period and question', () => {
    const key = draftKey({
      circleId: 'pair-1',
      role: 'b',
      periodId: 'period-9',
      questionId: 'q3'
    });
    assert.equal(key, 'draft:pair-1:b:period-9:q3');
    assert.equal(draftKey({ circleId: 'pair-1', role: 'b', periodId: 'period-9', questionId: 'q3' }), key);
    assert.notEqual(draftKey({ circleId: 'pair-2', role: 'b', periodId: 'period-9', questionId: 'q3' }), key);
  });

  it('keeps the 0.1.0 daily key readable', () => {
    assert.equal(legacyDailyDraftKey('circle', 'a', '2026-11-01'), 'draft-circle-a-2026-11-01');
  });

  it('does not let a late read overwrite newer text', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = () => resolve('old draft');
    });
    const controller = createDraftController({
      getValue: () => pending,
      setValue: async () => {}
    });
    const loading = controller.load('draft:pair:a:daily:q');
    controller.remember('draft:pair:a:daily:q', 'fresh');
    release();
    const result = await loading;
    assert.equal(result.value, 'fresh');
    assert.equal(result.superseded, true);
  });

  it('does not let an older write land after a newer one', async () => {
    const writes = [];
    let release;
    let markStarted;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { markStarted = resolve; });
    const controller = createDraftController({
      getValue: async () => '',
      setValue: async (_key, value) => {
        writes.push(value);
        if (writes.length === 1) {
          markStarted();
          await gate;
        }
      }
    });
    const key = 'draft:pair:a:daily:q';
    controller.remember(key, 'old');
    await started;
    controller.remember(key, 'new');
    release();
    await controller.flush(key);
    assert.equal(writes.at(-1), 'new');
    assert.ok(writes.indexOf('new') > writes.indexOf('old'));
  });

  it('falls back to a legacy daily draft when the new key is empty', async () => {
    const store = new Map([['draft-solo-b-2026-11-24', 'вчерашний черновик']]);
    const controller = createDraftController({
      getValue: async (key, fallback = '') => (store.has(key) ? store.get(key) : fallback),
      setValue: async (key, value) => { store.set(key, value); }
    });
    const result = await controller.load('draft:solo:b:daily:q1', {
      legacyKey: legacyDailyDraftKey('solo', 'b', '2026-11-24')
    });
    assert.equal(result.value, 'вчерашний черновик');
  });

  it('treats only the answer fields as keyboard-sensitive', () => {
    assert.equal(backgroundRenderWouldDismissKeyboard('answer-text'), true);
    assert.equal(backgroundRenderWouldDismissKeyboard('period-answer-text'), true);
    assert.equal(backgroundRenderWouldDismissKeyboard('name-setting'), false);
    assert.equal(backgroundRenderWouldDismissKeyboard(undefined), false);
  });
});
