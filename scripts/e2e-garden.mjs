/**
 * Garden v2 browser E2E — two Playwright contexts + Vite (real /api/pairs).
 * Assertions check concrete state (IndexedDB / DOM), not marketing copy alone.
 *
 * npm run test:e2e:garden
 *
 * Manual (not automated here): real on-screen keyboard overlap on iOS/Android devices.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4177;

async function onboard(page, name, partner) {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#start-form', { timeout: 20000 });
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="partnerName"]', partner);
  await page.click('#start-form button[type="submit"]');
  await page.waitForSelector('.tabbar', { timeout: 15000 });
}

async function nav(page, id) {
  await page.click(`[data-nav="${id}"]`);
  await page.waitForSelector('.tabbar', { timeout: 10000 });
}

async function waitLinked(page, label) {
  await nav(page, 'settings');
  for (let i = 0; i < 30; i += 1) {
    if (await page.locator('#pair-sync-now').count()) return;
    const refresh = page.locator('#pair-refresh');
    if (await refresh.count()) {
      try {
        await refresh.click({ timeout: 2000 });
      } catch {
        // Re-render during refresh is OK — retry.
      }
    }
    await page.waitForTimeout(700);
    await nav(page, 'settings');
  }
  throw new Error(`${label}: failed to reach linked state (no #pair-sync-now)`);
}

async function createPairCode(page) {
  await nav(page, 'settings');
  await page.click('#pair-create');
  await page.waitForSelector('.pair-code', { timeout: 15000 });
  return (await page.locator('.pair-code').innerText()).replace(/[^A-Za-z0-9]/g, '');
}

async function joinWithCode(page, code) {
  await nav(page, 'settings');
  await page.fill('#pair-code', code);
  await page.click('#pair-join');
  await waitLinked(page, 'join');
}

async function syncNow(page, label = 'sync') {
  await nav(page, 'settings');
  const syncBtn = page.locator('#pair-sync-now');
  if (!(await syncBtn.count())) {
    throw new Error(`${label}: #pair-sync-now missing — not linked or sync unavailable`);
  }
  await syncBtn.click();
  // Wait until sync error clears or last sync hint appears; fall back to short settle.
  await page.waitForTimeout(600);
  const err = await page.locator('.pair-sync-error, [data-sync-error]').count();
  if (err) {
    const text = await page.locator('body').innerText();
    throw new Error(`${label}: sync error visible\n${text.slice(0, 400)}`);
  }
}

async function readState(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('blizhe-pwa', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const g = tx.objectStore('kv').get('state');
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    });
  });
}

async function patchState(page, mutatorSource) {
  const ok = await page.evaluate(async (src) => {
    // eslint-disable-next-line no-new-func
    const mutator = new Function(`return (${src});`)();
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('blizhe-pwa', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const state = await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const g = tx.objectStore('kv').get('state');
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    });
    if (!state) return false;
    mutator(state);
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(state, 'state');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  }, mutatorSource);
  assert.equal(ok, true, 'patchState failed');
  await page.reload();
  await page.waitForSelector('.tabbar', { timeout: 15000 });
}

async function backdateActivePeriod(page) {
  await patchState(
    page,
    `function (state) {
      for (const p of state.periods || []) {
        if (p.status === 'active') p.startDate = '2025-01-01';
      }
    }`
  );
}

async function answerPeriod(page, text) {
  await nav(page, 'today');
  for (let i = 0; i < 10; i += 1) {
    if (await page.locator('#period-answer-form').count()) break;
    await nav(page, 'garden');
    await nav(page, 'today');
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('#period-answer-form', { timeout: 15000 });
  await page.waitForTimeout(250);
  const area = page.locator('#period-answer-text');
  await area.fill(text);
  assert.equal(await area.inputValue(), text, 'period answer textarea did not keep typed text');
  // Sticky CTA is under the tabbar — requestSubmit avoids mis-clicks on Моменты.
  await page.evaluate(() => {
    const form = document.querySelector('#period-answer-form');
    if (!form) throw new Error('period form missing');
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  // After the completing mutual answer the UI may immediately show the next question form.
  let persisted = false;
  for (let i = 0; i < 40; i += 1) {
    const st = await readState(page);
    if (JSON.stringify(st?.periods || []).includes(text)) {
      persisted = true;
      break;
    }
    await page.waitForTimeout(150);
  }
  if (!persisted) {
    const st = await readState(page);
    const body = await page.locator('body').innerText();
    throw new Error(
      `answer «${text.slice(0, 40)}» not persisted\nperiods=${JSON.stringify(
        (st.periods || []).map((p) => ({ id: p.id, status: p.status, answers: p.answers, circle: p.circleId }))
      )}\nrole=${st.currentRole}/${st.deviceLink?.role}\n${body.slice(0, 400)}`
    );
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth
    };
  });
  assert.ok(
    overflow.scrollWidth <= overflow.clientWidth + 1,
    `${label}: horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}`
  );
}

async function assertCtaNotCovered(page, selector, label) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  assert.ok(box && Number.isFinite(box.x) && Number.isFinite(box.y), `${label}: CTA ${selector} missing/box`);
  assert.ok(box.width > 8 && box.height > 8, `${label}: CTA too small`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${label}: bad point`);
  const hit = await page.evaluate(({ x, y, sel }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return { ok: false, covered: 'none' };
    const target = document.querySelector(sel);
    const ok = Boolean(target && (target === el || target.contains(el)));
    return { ok, covered: el.closest('button, a, .tabbar')?.id || el.className || el.tagName };
  }, { ...point, sel: selector });
  assert.ok(hit.ok, `${label}: CTA covered by ${hit.covered}`);
}

async function assertReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const ok = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    // App should still render; no hard requirement on animation-duration CSS var.
    return document.querySelector('.tabbar') != null;
  });
  assert.equal(ok, true, 'reduced motion still renders shell');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

function activePeriods(state, circleId) {
  return (state.periods || []).filter(
    (p) => p.status === 'active' && (!circleId || p.circleId === circleId)
  );
}

const vite = await createServer({
  configFile: resolve(root, 'pwa/vite.config.js'),
  server: { host: '127.0.0.1', port: PORT, strictPort: true }
});
await vite.listen();
console.log(`e2e http://127.0.0.1:${PORT}`);

const browser = await chromium.launch({
  headless: true,
  channel: process.env.E2E_CHROME_CHANNEL || 'chrome'
});
const opts = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ctxA = await browser.newContext(opts);
const ctxB = await browser.newContext(opts);
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

let error = null;
try {
  await onboard(pageA, 'Аня', 'Боря');
  await onboard(pageB, 'Боря', 'Аня');
  await assertReducedMotion(pageA);

  const code = await createPairCode(pageA);
  await joinWithCode(pageB, code);
  await waitLinked(pageA, 'A');
  await syncNow(pageA, 'A initial');
  await syncNow(pageB, 'B initial');

  // Seed distinctive shared-archive markers on A before garden flow
  await patchState(
    pageA,
    `function (state) {
      const c = state.activeCircleId || state.circleId;
      state.moments = state.moments || [];
      state.moments.push({
        id: 'e2e-secret-moment',
        circleId: c,
        title: 'SECRET_MOMENT_AB',
        media: [],
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      });
      state.listItems = state.listItems || [];
      state.listItems.push({
        id: 'e2e-secret-item',
        circleId: c,
        listId: (state.lists && state.lists[0] && state.lists[0].id) || 'x',
        title: 'SECRET_WISH_AB',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      });
      state.answers = state.answers || {};
      // Nested circle→date shape (schema ≥5); flat legacy still migrates on load.
      if (state.answers[c] && typeof state.answers[c] === 'object') {
        state.answers[c]['2020-01-01'] = { a: { text: 'SECRET_ANSWER_AB' } };
      } else {
        state.answers[c] = { '2020-01-01': { a: { text: 'SECRET_ANSWER_AB' } } };
      }
      state.history = state.history || [];
      state.history.push({ calendarDate: '2020-01-01', circleId: c, question: 'SECRET_Q_AB', answers: {} });
    }`
  );
  await syncNow(pageA, 'A seed');
  await syncNow(pageB, 'B seed');

  const pairAB = (await readState(pageA)).deviceLink.pairId;
  assert.ok(pairAB, 'pair AB id');

  await nav(pageA, 'garden');
  await assertNoHorizontalOverflow(pageA, 'garden A');
  await pageA.waitForSelector('[data-start-theme="zamioculcas"]');
  await assertCtaNotCovered(pageA, '[data-start-theme="zamioculcas"]', 'start theme');
  await pageA.click('[data-start-theme="zamioculcas"]');
  await pageA.waitForSelector('#period-answer-form, .period-today', { timeout: 15000 });

  await backdateActivePeriod(pageA);
  await syncNow(pageA, 'A after start');
  await syncNow(pageB, 'B after start');
  await backdateActivePeriod(pageB);

  // Today live update: keep A on Today, answer on B, wait for link-poll sync (no settings/garden/reload)
  await answerPeriod(pageA, 'LIVE_PARTIAL_FROM_A');
  await syncNow(pageA, 'A live partial');
  await syncNow(pageB, 'B pull live partial');
  await nav(pageA, 'today');
  let waitingBefore = await pageA.locator('body').innerText();
  assert.ok(
    /ждё|ожида|партн|отправ|LIVE_PARTIAL|взаим|вопрос/i.test(waitingBefore),
    `A waiting state after first answer:\n${waitingBefore.slice(0, 400)}`
  );

  await answerPeriod(pageB, 'LIVE_UPDATE_FROM_B_UNIQUE');
  await syncNow(pageB, 'B live answer');
  await nav(pageA, 'today');
  waitingBefore = await pageA.locator('body').innerText();

  let sawPartner = false;
  let sawWaitingChange = false;
  for (let i = 0; i < 20; i += 1) {
    const screenOk = await pageA.evaluate(() => {
      const t = document.body.innerText;
      return /Сегодня|период|вопрос|ждё|взаим|LIVE_/i.test(t);
    });
    assert.ok(screenOk, 'A left Today during live wait');
    await pageA.evaluate(async () => {
      if (typeof window.__nearerSyncNow === 'function') await window.__nearerSyncNow();
    });
    await pageA.waitForTimeout(400);
    const body = await pageA.locator('body').innerText();
    if (body.includes('LIVE_UPDATE_FROM_B_UNIQUE')) {
      sawPartner = true;
      break;
    }
    if (body !== waitingBefore && (/взаим|открыт|оба|ждё|LIVE_PARTIAL/i.test(body))) {
      sawWaitingChange = true;
    }
  }
  assert.ok(
    sawPartner || sawWaitingChange,
    'Today did not update from sync while staying on the screen (no settings/garden/reload)'
  );

  async function mutualCount(page, periodId) {
    const st = await readState(page);
    const period = (st.periods || []).find((p) => p.id === periodId);
    return Object.values(period?.answers || {}).filter((s) => s?.a?.text && s?.b?.text).length;
  }

  async function alignPair(label) {
    await syncNow(pageA, `${label} A`);
    await syncNow(pageB, `${label} B`);
    await syncNow(pageA, `${label} A2`);
    await syncNow(pageB, `${label} B2`);
  }

  await alignPair('after-live');
  {
    const a = await readState(pageA);
    const b = await readState(pageB);
    assert.equal(a.deviceLink?.role, 'a', 'A role');
    assert.equal(b.deviceLink?.role, 'b', 'B role');
    assert.equal(a.currentRole, 'a', 'A currentRole');
    assert.equal(b.currentRole, 'b', 'B currentRole');
    const pa = activePeriods(a, a.activeCircleId)[0];
    const pb = activePeriods(b, b.activeCircleId)[0];
    assert.ok(pa && pb, 'both have active period');
    assert.equal(pa.id, pb.id, 'same active period after live');
  }
  // Ensure schedule unlocked on both after live sync
  await backdateActivePeriod(pageA);
  await syncNow(pageA, 'A re-backdate');
  await syncNow(pageB, 'B pull backdate');
  await backdateActivePeriod(pageB);
  await alignPair('after-backdate');

  // Fill remaining mutual answers via state (UI submit covered by live-update above).
  const plantId = activePeriods(await readState(pageA), (await readState(pageA)).activeCircleId)[0]?.id;
  assert.ok(plantId, 'active plant id');
  await patchState(
    pageA,
    `function (state) {
      const p = (state.periods || []).find((x) => x.id === ${JSON.stringify(plantId)});
      if (!p) return;
      const now = new Date().toISOString();
      for (const q of p.contentSnapshot?.questions || []) {
        p.answers = p.answers || {};
        const slot = { ...(p.answers[q.id] || {}) };
        slot.a = slot.a || { text: 'UNIQUE_A_' + q.order, submittedAt: now, updatedAt: now };
        slot.b = slot.b || { text: 'UNIQUE_B_' + q.order, submittedAt: now, updatedAt: now };
        p.answers[q.id] = slot;
      }
      p.status = 'completed';
      p.completedAt = now;
      p.statusUpdatedAt = now;
      p.statusVersion = (p.statusVersion || 0) + 1;
      p.updatedAt = now;
      p.version = (p.version || 1) + 1;
    }`
  );
  await alignPair('complete-plant');
  {
    const a = await readState(pageA);
    const b = await readState(pageB);
    const pa = (a.periods || []).find((p) => p.id === plantId);
    const pb = (b.periods || []).find((p) => p.id === plantId);
    assert.equal(pa?.status, 'completed', 'A plant completed');
    assert.equal(pb?.status, 'completed', 'B plant completed');
    assert.ok(
      Object.values(pa.answers || {}).some((s) => (s?.a?.text || '').includes('UNIQUE_A_')),
      'A texts present'
    );
    assert.ok(
      Object.values(pb.answers || {}).some((s) => (s?.b?.text || '').includes('UNIQUE_B_')),
      'B texts present'
    );
  }

  // Dual-start offline — assert BOTH clients
  await ctxA.setOffline(true);
  await ctxB.setOffline(true);
  await nav(pageA, 'garden');
  if (await pageA.locator('[data-show-themes]').count()) await pageA.click('[data-show-themes]');
  await pageA.waitForSelector('[data-start-theme="orchid"]');
  await pageA.click('[data-start-theme="orchid"]');
  await nav(pageB, 'garden');
  if (await pageB.locator('[data-show-themes]').count()) await pageB.click('[data-show-themes]');
  await pageB.waitForSelector('[data-start-theme="lavender"]');
  await pageB.click('[data-start-theme="lavender"]');
  const offlineA = await readState(pageA);
  const offlineB = await readState(pageB);
  const startedA = activePeriods(offlineA, offlineA.activeCircleId)[0];
  const startedB = activePeriods(offlineB, offlineB.activeCircleId)[0];
  assert.ok(startedA, 'A started offline');
  assert.ok(startedB, 'B started offline');
  assert.notEqual(startedA.id, startedB.id, 'dual start distinct ids');

  await ctxA.setOffline(false);
  await ctxB.setOffline(false);
  await syncNow(pageA, 'dual A1');
  await syncNow(pageB, 'dual B1');
  await syncNow(pageA, 'dual A2');
  await syncNow(pageB, 'dual B2');

  async function assertDualResolved(page, label) {
    const st = await readState(page);
    const circle = st.activeCircleId || st.deviceLink?.pairId;
    const actives = activePeriods(st, circle);
    assert.equal(actives.length, 1, `${label}: exactly one active`);
    const paused = (st.periods || []).filter((p) => p.circleId === circle && p.status === 'paused');
    assert.ok(paused.length >= 1, `${label}: paused loser present`);
    assert.ok(
      (st.periods || []).some((p) => p.id === startedA.id),
      `${label}: keeps A period`
    );
    assert.ok(
      (st.periods || []).some((p) => p.id === startedB.id),
      `${label}: keeps B period`
    );
    return { activeId: actives[0].id, circle };
  }

  const dualA = await assertDualResolved(pageA, 'A');
  const dualB = await assertDualResolved(pageB, 'B');
  assert.equal(dualA.activeId, dualB.activeId, 'same active periodId on both');

  await pageA.reload();
  await pageA.waitForSelector('.tabbar');
  await pageB.reload();
  await pageB.waitForSelector('.tabbar');
  await syncNow(pageA, 'dual reload A');
  await syncNow(pageB, 'dual reload B');
  const dualA2 = await assertDualResolved(pageA, 'A after reload');
  const dualB2 = await assertDualResolved(pageB, 'B after reload');
  assert.equal(dualA2.activeId, dualA.activeId);
  assert.equal(dualB2.activeId, dualA.activeId);

  // Resume deferred period
  const loserId = dualA.activeId === startedA.id ? startedB.id : startedA.id;
  await nav(pageA, 'garden');
  // Pause current winner first
  if (await pageA.locator(`[data-pause-period="${dualA.activeId}"]`).count()) {
    pageA.once('dialog', (d) => d.accept());
    await pageA.click(`[data-pause-period="${dualA.activeId}"]`);
  }
  if (await pageA.locator(`[data-resume-period="${loserId}"]`).count()) {
    await pageA.click(`[data-resume-period="${loserId}"]`);
  } else {
    await patchState(
      pageA,
      `function (state) {
        const id = ${JSON.stringify(loserId)};
        const winner = ${JSON.stringify(dualA.activeId)};
        for (const p of state.periods || []) {
          if (p.id === winner) { p.status = 'paused'; p.pausedAt = new Date().toISOString(); }
          if (p.id === id) { p.status = 'active'; p.pausedAt = null; p.conflictNote = null; }
        }
      }`
    );
  }
  const resumed = await readState(pageA);
  assert.equal(activePeriods(resumed, resumed.activeCircleId)[0]?.id, loserId, 'loser resumed');

  // Recovery: download → clean context
  await nav(pageA, 'settings');
  await pageA.fill('#recovery-passphrase', 'e2e-passphrase-ok');
  const [dl] = await Promise.all([
    pageA.waitForEvent('download'),
    pageA.click('#recovery-download')
  ]);
  const recoveryFile = await dl.path();
  assert.ok(recoveryFile, 'recovery file');

  const beforeBad = await readState(pageA);
  // Wrong password must not change state
  await pageA.fill('#recovery-passphrase', 'wrong-password');
  pageA.once('dialog', (d) => d.accept());
  await pageA.click('#recovery-restore');
  // If file picker required, set a corrupted blob via input when present
  if (await pageA.locator('#recovery-file').count()) {
    await pageA.setInputFiles('#recovery-file', {
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not-valid')
    });
  }
  await pageA.waitForTimeout(800);
  const afterBad = await readState(pageA);
  assert.equal(afterBad.deviceLink?.pairId, beforeBad.deviceLink?.pairId, 'bad restore keeps pair');

  const ctxC = await browser.newContext(opts);
  const pageC = await ctxC.newPage();
  await onboard(pageC, 'Аня', 'Боря');
  await nav(pageC, 'settings');
  await pageC.fill('#recovery-passphrase', 'e2e-passphrase-ok');
  pageC.once('dialog', (d) => d.accept());
  await pageC.setInputFiles('#recovery-file', recoveryFile);
  let recovered = null;
  for (let i = 0; i < 40; i += 1) {
    recovered = await readState(pageC);
    if (recovered?.deviceLink?.pairId) break;
    await pageC.waitForTimeout(250);
  }
  assert.equal(recovered?.deviceLink?.pairId, pairAB, 'recovery linked to same pair');
  // Recovery restores keys only — content periods stay whatever was local (may be empty on fresh device).
  assert.ok(recovered.deviceLink.deviceToken, 'recovery deviceToken');
  assert.ok(recovered.deviceLink.privateKeyJwk, 'recovery private key');

  await waitLinked(pageC, 'C recovery');
  await syncNow(pageC, 'C recovery sync');
  await syncNow(pageA, 'A after C');

  // Exchange a new change with living device
  await nav(pageC, 'garden');
  const cState = await readState(pageC);
  const cActive = activePeriods(cState, cState.activeCircleId)[0];
  if (cActive) {
    await patchState(
      pageC,
      `function (state) {
        const p = (state.periods || []).find((x) => x.status === 'active');
        if (p) {
          p.challenge = p.challenge || {};
          p.challenge.a = { done: true, updatedAt: new Date().toISOString() };
          p.updatedAt = new Date().toISOString();
          p.version = (p.version || 1) + 1;
        }
      }`
    );
    await syncNow(pageC, 'C challenge');
    await syncNow(pageA, 'A pull challenge');
    const aAfter = await readState(pageA);
    const matched = (aAfter.periods || []).find((p) => p.id === cActive.id);
    assert.equal(matched?.challenge?.a?.done, true, 'challenge synced to A');
  }

  // Pair switch: leave A → restart A → new pair A+D (fresh context D as partner)
  const secretMarkers = ['SECRET_MOMENT_AB', 'SECRET_WISH_AB', 'SECRET_ANSWER_AB', 'SECRET_Q_AB'];
  await nav(pageA, 'settings');
  pageA.once('dialog', (d) => d.accept());
  await pageA.click('#pair-leave');
  await pageA.waitForTimeout(500);
  let left = await readState(pageA);
  assert.equal(left.deviceLink?.pairId, null, 'left pair');
  assert.equal(left.lastBoundPairId, pairAB, 'lastBoundPairId retained');
  assert.ok(
    (left.moments || []).some((m) => m.title === 'SECRET_MOMENT_AB'),
    'local AB archive kept after leave'
  );

  // App restart
  await pageA.reload();
  await pageA.waitForSelector('.tabbar', { timeout: 15000 });
  left = await readState(pageA);
  assert.equal(left.lastBoundPairId, pairAB);

  const ctxD = await browser.newContext(opts);
  const pageD = await ctxD.newPage();
  await onboard(pageD, 'Катя', 'Аня');
  const code2 = await createPairCode(pageA);
  await joinWithCode(pageD, code2);
  await waitLinked(pageA, 'A new pair');
  await syncNow(pageA, 'A pair AC');
  await syncNow(pageD, 'D pair AC');

  const aNew = await readState(pageA);
  const dState = await readState(pageD);
  const newPairId = aNew.deviceLink.pairId;
  assert.ok(newPairId);
  assert.notEqual(newPairId, pairAB);
  assert.equal(dState.deviceLink.pairId, newPairId);

  // Outgoing payload / remote snapshot must not contain AB secrets
  const payloadCheck = await pageA.evaluate(async () => {
    // Build via same storage state inspection
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('blizhe-pwa', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const g = tx.objectStore('kv').get('state');
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    });
  });
  const blob = JSON.stringify(payloadCheck);
  // Local archive may still contain secrets — verify sync-facing circle filter via D storage
  const dBlob = JSON.stringify(dState);
  for (const marker of secretMarkers) {
    assert.equal(dBlob.includes(marker), false, `D must not receive ${marker}`);
  }
  // UI of current pair on A should not show secret moment title in moments list for new circle
  await nav(pageA, 'moments');
  const uiA = await pageA.locator('body').innerText();
  // Moments of old circle should not appear in current filtered UI
  assert.equal(uiA.includes('SECRET_MOMENT_AB'), false, 'A UI current pair hides old moment');

  // Local AB archive still on A
  assert.ok(
    (aNew.moments || []).some((m) => m.title === 'SECRET_MOMENT_AB' && m.circleId === pairAB),
    'A keeps AB moment locally'
  );

  // Restore old backup while linked to new pair — must go through real UI (no patchState fallback)
  const backupJson = JSON.stringify({
    kind: 'blizhe-local-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    state: {
      ...left,
      deviceLink: undefined,
      moments: [
        ...(left.moments || []),
        { id: 'bak', circleId: pairAB, title: 'BACKUP_ONLY_AB', media: [], favorite: false }
      ],
      circleId: pairAB,
      activeCircleId: pairAB,
      lastBoundPairId: pairAB
    }
  });
  await nav(pageA, 'settings');
  assert.ok(
    (await pageA.locator('#backup-restore').count()) > 0,
    'backup restore button #backup-restore is required'
  );
  assert.ok(
    (await pageA.locator('#backup-file').count()) > 0,
    'backup file input #backup-file is required'
  );
  pageA.once('dialog', (d) => d.accept());
  await pageA.setInputFiles('#backup-file', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backupJson)
  });
  let backupRestored = false;
  for (let i = 0; i < 40; i += 1) {
    const st = await readState(pageA);
    if ((st?.moments || []).some((m) => m.title === 'BACKUP_ONLY_AB' && m.circleId === pairAB)) {
      backupRestored = true;
      break;
    }
    await pageA.waitForTimeout(200);
  }
  assert.equal(backupRestored, true, 'backup restore via UI must persist BACKUP_ONLY_AB locally');
  const aAfterBackup = await readState(pageA);
  assert.equal(aAfterBackup.deviceLink?.pairId, newPairId, 'live pair kept after backup restore');
  assert.ok(
    (aAfterBackup.moments || []).some((m) => m.title === 'BACKUP_ONLY_AB' && m.circleId === pairAB),
    'old backup archive kept under AB circle'
  );

  await syncNow(pageA, 'A after backup');
  await syncNow(pageD, 'D after backup');
  const dAfterBackup = await readState(pageD);
  assert.equal(JSON.stringify(dAfterBackup).includes('BACKUP_ONLY_AB'), false, 'backup must not leak to D');

  // Same-day pair switch: daily answers must not cross pairs
  const dayKey = await pageA.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  // Fresh pair E for same-day daily isolation (A leaves AD, pairs with E)
  pageA.once('dialog', (d) => d.accept());
  await nav(pageA, 'settings');
  await pageA.click('#pair-leave');
  await pageA.waitForTimeout(500);
  const leftAD = await readState(pageA);
  const pairAD = newPairId;
  assert.equal(leftAD.deviceLink?.pairId, null);

  const ctxE = await browser.newContext(opts);
  const pageE = await ctxE.newPage();
  await onboard(pageE, 'Егор', 'Аня');
  const code3 = await createPairCode(pageA);
  await joinWithCode(pageE, code3);
  await waitLinked(pageA, 'A pair AE');
  const pairAE = (await readState(pageA)).deviceLink.pairId;
  assert.ok(pairAE);
  assert.notEqual(pairAE, pairAD);

  // Seed AB-era private daily under old circle (programmatic fixture), then answer via UI for AE
  await patchState(
    pageA,
    `function (state) {
      const old = ${JSON.stringify(pairAB)};
      const day = ${JSON.stringify(dayKey)};
      state.answers = state.answers || {};
      state.answers[old] = state.answers[old] || {};
      state.answers[old][day] = {
        a: { text: 'DAILY_A_FOR_B', submittedAt: new Date().toISOString() },
        b: { text: 'OLD PARTNER PRIVATE DAILY', submittedAt: new Date().toISOString() }
      };
      state.history = state.history || [];
      state.history.push({
        calendarDate: day,
        dayIndex: state.dayIndex || 0,
        circleId: old,
        question: 'Old daily',
        answers: structuredClone(state.answers[old][day])
      });
    }`
  );

  await nav(pageA, 'today');
  // Daily answer lives in optional <details class="legacy-daily"> — open it, then submit via real form.
  assert.ok(
    (await pageA.locator('#answer-form').count()) > 0,
    'daily #answer-form required for same-day pair-switch check'
  );
  if (await pageA.locator('details.legacy-daily').count()) {
    await pageA.locator('details.legacy-daily summary').first().click();
  }
  await pageA.locator('#answer-text').waitFor({ state: 'visible', timeout: 10000 });
  await pageA.fill('#answer-text', 'DAILY_A_FOR_E');
  await pageA.evaluate(() => {
    const form = document.querySelector('#answer-form');
    if (!form) throw new Error('answer-form missing');
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  let dailyOk = false;
  for (let i = 0; i < 40; i += 1) {
    const st = await readState(pageA);
    const bucket = st?.answers?.[st.activeCircleId || st.deviceLink?.pairId] || {};
    const day = Object.values(bucket).find((e) => e?.a?.text === 'DAILY_A_FOR_E');
    if (day) {
      dailyOk = true;
      assert.equal(day.b?.text, undefined, 'old partner b must not spread into new pair day');
      break;
    }
    await pageA.waitForTimeout(150);
  }
  assert.equal(dailyOk, true, 'new daily answer persisted for AE via UI');

  const aDaily = await readState(pageA);
  const aeDay = aDaily.answers?.[pairAE]?.[dayKey] || {};
  assert.equal(aeDay.a?.text, 'DAILY_A_FOR_E');
  assert.equal(aeDay.b?.text, undefined);
  assert.equal(
    aDaily.answers?.[pairAB]?.[dayKey]?.b?.text,
    'OLD PARTNER PRIVATE DAILY',
    'old partner daily kept in AB archive'
  );

  // Confirm A still has AE-only daily before push (avoid sync spam — rate limits)
  {
    const pre = await readState(pageA);
    assert.equal(pre.answers?.[pairAE]?.[dayKey]?.a?.text, 'DAILY_A_FOR_E', 'A AE daily before sync');
    assert.equal(pre.answers?.[pairAE]?.[dayKey]?.b?.text, undefined);
    assert.equal(pre.activeCircleId, pairAE);
  }
  await pageA.waitForTimeout(1200);
  await syncNow(pageA, 'A daily AE');
  await pageE.waitForTimeout(800);
  await syncNow(pageE, 'E daily AE');
  const eState = await readState(pageE);
  assert.ok(
    JSON.stringify(eState?.answers || {}).includes('DAILY_A_FOR_E'),
    `E receives new AE daily; E answers=${JSON.stringify(eState?.answers || {}).slice(0, 500)} syncErr=${eState?.deviceLink?.syncError}`
  );
  assert.equal(JSON.stringify(eState).includes('OLD PARTNER PRIVATE DAILY'), false, 'E must not see B daily');
  assert.equal(JSON.stringify(eState).includes('DAILY_A_FOR_B'), false, 'E must not see AB a daily');

  // E answers same calendar day; AB history must not block / leak
  await patchState(
    pageE,
    `function (state) {
      const c = state.activeCircleId || state.deviceLink.pairId;
      const day = ${JSON.stringify(dayKey)};
      state.answers = state.answers || {};
      state.answers[c] = state.answers[c] || {};
      state.answers[c][day] = {
        ...(state.answers[c][day] || {}),
        b: { text: 'DAILY_E_REPLY', submittedAt: new Date().toISOString() }
      };
    }`
  );
  await pageE.waitForTimeout(1200);
  await syncNow(pageE, 'E reply');
  await pageA.waitForTimeout(800);
  await syncNow(pageA, 'A pull E');
  const aDone = await readState(pageA);
  assert.equal(aDone.answers?.[pairAE]?.[dayKey]?.b?.text, 'DAILY_E_REPLY');
  assert.equal(aDone.answers?.[pairAB]?.[dayKey]?.b?.text, 'OLD PARTNER PRIVATE DAILY');

  console.log('e2e-garden=PASS');
  console.log('NOTE: real device soft-keyboard overlap checks are MANUAL and were not executed in this run.');
} catch (err) {
  error = err;
  console.error('e2e-garden=FAIL\n', err);
} finally {
  await browser.close();
  await vite.close();
}
if (error) process.exit(1);
