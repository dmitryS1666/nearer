import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { releaseNotes, shouldShowReleaseNotes } from '../domain/releaseNotes.js';

describe('release notes', () => {
  it('shows once after onboarding until this version is acknowledged', () => {
    assert.equal(shouldShowReleaseNotes({ onboarded: false }, '0.2.0'), false);
    assert.equal(shouldShowReleaseNotes({ onboarded: true }, '0.2.0'), true);
    assert.equal(shouldShowReleaseNotes({ onboarded: true, releaseSeen: '0.1.0' }, '0.2.0'), true);
    assert.equal(shouldShowReleaseNotes({ onboarded: true, releaseSeen: '0.2.0' }, '0.2.0'), false);
  });

  it('keeps the note short and free of private data', () => {
    const note = releaseNotes('0.2.0');
    const text = `${note.title} ${note.lede} ${note.points.join(' ')}`;
    assert.match(note.eyebrow, /0\.2\.0/);
    assert.equal(note.points.length, 3);
    assert.equal(/pairId|ключ|пароль|admin/i.test(text), false);
  });
});
