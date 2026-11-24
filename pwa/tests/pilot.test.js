import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPilotStore } from '../../server/pilotStore.js';
import { createAdminAuth } from '../../server/adminAuth.js';
import { createPilotService } from '../../server/pilotService.js';
import { createPairStore } from '../../server/pairStore.js';
import { eventMaySend, sanitizeEventProps, hashPairId } from '../domain/pilotClient.js';

function service(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nearer-pilot-'));
  const store = createPilotStore({ filePath: join(dir, 'pilot.json'), retentionDays: 30 });
  const auth = createAdminAuth({ password: 'correct horse battery' });
  const pairStore = createPairStore();
  const created = pairStore.create(1_000, { publicKey: 'a'.repeat(90) });
  const pilot = createPilotService({
    store,
    auth,
    pairStore,
    now: () => new Date('2026-11-24T12:00:00.000Z'),
    ...extra
  });
  return { pilot, store, created };
}

async function login(pilot) {
  const result = await pilot.handle({
    method: 'POST',
    path: '/api/admin/login',
    rawBody: JSON.stringify({ password: 'correct horse battery' }),
    ip: '10.0.0.8'
  });
  const cookie = result.headers['set-cookie'];
  return { cookie, csrf: result.json.csrf };
}

describe('pilot admin', () => {
  it('hides the dashboard and pair ciphertext from anonymous callers', async () => {
    const { pilot } = service();
    const dash = await pilot.handle({ method: 'GET', path: '/api/admin/dashboard' });
    assert.equal(dash.status, 401);
    const page = await pilot.handle({ method: 'GET', path: '/admin' });
    assert.equal(page.status, 200);
    assert.equal(page.body.includes('correct horse'), false);
    assert.equal(page.body.includes('ciphertext'), false);
  });

  it('requires the csrf header before changing feedback', async () => {
    const { pilot } = service();
    const session = await login(pilot);
    const open = await pilot.handle({
      method: 'GET',
      path: '/api/admin/dashboard',
      headers: { cookie: session.cookie }
    });
    assert.equal(open.status, 200);
    assert.equal(JSON.stringify(open.json).includes('ciphertext'), false);
    assert.equal(typeof open.json.technicalPairs.created, 'number');
    const denied = await pilot.handle({
      method: 'POST',
      path: '/api/admin/versions',
      headers: { cookie: session.cookie },
      rawBody: JSON.stringify({ platform: 'web', versionName: '0.2.0', versionCode: 2, releaseNotes: 'ok' })
    });
    assert.equal(denied.status, 403);
  });

  it('rejects answer text and counts a consented ritual', async () => {
    const { pilot } = service();
    const leaked = await pilot.handle({
      method: 'POST',
      path: '/api/pilot/events',
      rawBody: JSON.stringify({
        event: 'question_answered',
        consent: 'granted',
        installId: 'install-12345678',
        text: 'секретный ответ'
      })
    });
    assert.equal(leaked.status, 400);
    const ok = await pilot.handle({
      method: 'POST',
      path: '/api/pilot/events',
      rawBody: JSON.stringify({
        event: 'mutual_answer_completed',
        consent: 'granted',
        installId: 'install-12345678',
        platform: 'android',
        versionName: '0.2.0',
        role: 'a',
        pairHash: 'a'.repeat(24),
        props: { length: 12, text: 'нельзя' }
      })
    });
    assert.equal(ok.status, 202);
    const session = await login(pilot);
    const dash = await pilot.handle({
      method: 'GET',
      path: '/api/admin/dashboard',
      headers: { cookie: session.cookie }
    });
    assert.equal(dash.json.mutualRituals, 1);
    assert.equal(JSON.stringify(dash.json).includes('нельзя'), false);
  });

  it('stores feedback and does not mail a reply without a contact', async () => {
    const { pilot } = service();
    const sent = await pilot.handle({
      method: 'POST',
      path: '/api/feedback',
      rawBody: JSON.stringify({
        type: 'bug',
        message: 'Клавиатура прыгает',
        rating: 2,
        consent: true,
        appVersion: '0.2.0',
        platform: 'android',
        osVersion: '14',
        installId: 'install-abcdef12'
      }),
      ip: '10.1.1.1'
    });
    assert.equal(sent.status, 201);
    const session = await login(pilot);
    const saved = await pilot.handle({
      method: 'POST',
      path: `/api/admin/feedback/${sent.json.id}`,
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      rawBody: JSON.stringify({ status: 'doing', note: 'смотрим', reply: 'привет' })
    });
    assert.equal(saved.status, 400);
    const noted = await pilot.handle({
      method: 'POST',
      path: `/api/admin/feedback/${sent.json.id}`,
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      rawBody: JSON.stringify({ status: 'doing', note: 'смотрим', reply: '' })
    });
    assert.equal(noted.status, 200);
  });

  it('refuses a mass push without confirmation', async () => {
    const { pilot } = service({
      dispatchPush: async () => ({ accepted: 1, failed: 0, status: 'sent', invalidIds: [] })
    });
    const session = await login(pilot);
    const denied = await pilot.handle({
      method: 'POST',
      path: '/api/admin/pushes',
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      rawBody: JSON.stringify({
        title: 'Обновление',
        body: 'Можно обновить Ближе',
        screen: 'settings',
        audience: 'all',
        kind: 'technical',
        confirm: false,
        test: false
      })
    });
    assert.equal(denied.status, 400);
  });
});

describe('pilot client consent', () => {
  it('sends product events only after consent and strips private props', async () => {
    assert.equal(eventMaySend('unknown', 'app_opened'), false);
    assert.equal(eventMaySend('granted', 'question_answered'), true);
    assert.equal(eventMaySend('denied', 'pair_created'), false);
    assert.equal(eventMaySend('unknown', 'pair_created'), true);
    const safe = sanitizeEventProps({ length: 8, text: 'секрет', source: 'settings' });
    assert.deepEqual(safe, { length: 8, source: 'settings' });
    const hash = await hashPairId('pair-secret');
    assert.equal(hash.length, 24);
    assert.equal(hash.includes('pair-secret'), false);
  });
});
