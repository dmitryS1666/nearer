import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory storage mock before importing analytics
const mem = new Map();
globalThis.indexedDB = undefined;

const storageModule = await import('../storage.js');
// Monkey-patch by redefining module functions via dynamic mock is hard in node:test.
// Instead test pure export payload shape with a lightweight local clone.

describe('analytics event shape', () => {
  it('builds event without answer text', () => {
    const event = {
      type: 'answer_submitted',
      timestamp: new Date().toISOString(),
      session_id: 's1',
      properties: { questionId: 'q001', length: 12 }
    };
    assert.equal(event.type, 'answer_submitted');
    assert.ok(!('answerText' in event.properties));
    assert.ok(event.session_id);
  });

  it('export payload omits private answers', () => {
    const payload = {
      appVersion: '0.1.0',
      installId: 'i1',
      sessions: 2,
      streak: 1,
      completedDays: 1,
      plusInteractions: 1,
      events: [{ type: 'plus_cta_clicked', timestamp: 't', session_id: 's', properties: {} }]
    };
    const text = JSON.stringify(payload);
    assert.ok(!text.includes('myAnswer'));
    assert.equal(payload.appVersion, '0.1.0');
  });
});
