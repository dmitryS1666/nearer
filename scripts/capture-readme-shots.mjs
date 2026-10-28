/**
 * Refresh README product screenshots (mobile 390×844).
 * Writes docs/screenshots/01–08 and docs/screenshots/new/*.
 *
 *   npm run dev          # :4173
 *   npm run shots        # this script
 *
 * Override base URL: PWA_URL=http://127.0.0.1:4173 npm run shots
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'docs/screenshots');
const OUT_NEW = resolve(OUT, 'new');
const BASE = process.env.PWA_URL || 'http://127.0.0.1:4173';
mkdirSync(OUT, { recursive: true });
mkdirSync(OUT_NEW, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: process.env.E2E_CHROME_CHANNEL || 'chrome'
});
const context = await browser.newContext({
  ...devices['iPhone 14'],
  locale: 'ru-RU',
  viewport: { width: 390, height: 844 }
});
const page = await context.newPage();

async function clearStore() {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        localStorage.clear();
        sessionStorage.clear();
        const req = indexedDB.deleteDatabase('blizhe-pwa');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
        setTimeout(resolve, 800);
      })
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#start-form, .tabbar', { timeout: 20000 });
}

async function clearToasts() {
  await page.evaluate(() => {
    const root = document.getElementById('toast-root');
    if (root) root.innerHTML = '';
  });
}

async function shot(dir, name) {
  await clearToasts();
  await page.waitForTimeout(280);
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: false });
  console.log('saved', name);
}

async function unlockLab() {
  const logo = page.locator('#brand-logo');
  await logo.dispatchEvent('pointerdown');
  await page.waitForTimeout(3200);
  await logo.dispatchEvent('pointerup');
  await page.waitForTimeout(400);
  await clearToasts();
}

async function nav(id) {
  await page.click(`[data-nav="${id}"]`);
  await page.waitForSelector('.tabbar', { timeout: 10000 });
  await page.waitForTimeout(200);
}

async function patchState(mutatorSource) {
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
  if (!ok) throw new Error('patchState failed');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tabbar', { timeout: 15000 });
}

async function seedArchiveDemo() {
  await patchState(`function (state) {
    const c = state.activeCircleId || state.circleId || 'solo';
    state.activeCircleId = c;
    state.circleId = c;
    const now = new Date().toISOString();
    const listWish = (state.lists || []).find((l) => l.type === 'wishlist' || l.seedKey === 'wishlist');
    const listPlaces = (state.lists || []).find((l) => l.type === 'places' || l.seedKey === 'places');
    const wishId = listWish?.id || 'list-wish';
    const placesId = listPlaces?.id || 'list-places';
    if (!listWish) {
      state.lists = state.lists || [];
      state.lists.push({
        id: wishId, circleId: c, name: 'Хотелки', icon: '🎁', type: 'wishlist', seedKey: 'wishlist',
        createdAt: now, updatedAt: now, version: 1
      });
    } else listWish.circleId = c;
    if (!listPlaces) {
      state.lists.push({
        id: placesId, circleId: c, name: 'Куда сходить', icon: '🍴', type: 'places', seedKey: 'places',
        createdAt: now, updatedAt: now, version: 1
      });
    } else listPlaces.circleId = c;

    state.listItems = [
      {
        id: 'item-1', circleId: c, listId: wishId, title: 'Плед для дивана',
        url: 'https://example.com/plaid', priority: 'soon', status: 'open',
        notes: 'Мягкий, серо-бежевый', createdAt: now, updatedAt: now, version: 1, metadata: {}
      },
      {
        id: 'item-2', circleId: c, listId: wishId, title: 'Настольная лампа',
        url: '', priority: 'someday', status: 'open',
        notes: '', createdAt: now, updatedAt: now, version: 1, metadata: {}
      },
      {
        id: 'item-3', circleId: c, listId: placesId, title: 'Ужин в «Тбилиси»',
        url: '', priority: 'soon', status: 'open',
        notes: 'Попробовать хачапури', createdAt: now, updatedAt: now, version: 1, metadata: {}
      },
      {
        id: 'item-4', circleId: c, listId: placesId, title: 'Прогулка у реки',
        url: '', priority: 'someday', status: 'done',
        notes: '', createdAt: now, updatedAt: now, version: 1, metadata: {}
      }
    ];

    state.moments = [
      {
        id: 'mom-1', circleId: c, title: 'Вечер в Стамбуле', favorite: true,
        date: '2026-06-12', description: 'Чай на крыше и закат над Босфором.',
        location: { name: 'Стамбул' }, media: [], tags: ['путешествие'], relatedPeople: ['Катя'],
        relatedListItems: [], createdAt: now, updatedAt: now, version: 1
      },
      {
        id: 'mom-2', circleId: c, title: 'Первый дождь лета', favorite: false,
        date: '2026-05-03', description: 'Бежали под одним зонтом.',
        location: { name: 'Дом' }, media: [], tags: [], relatedPeople: [],
        relatedListItems: [], createdAt: now, updatedAt: now, version: 1
      }
    ];

    state.importantDates = [
      { id: 'd1', circleId: c, title: 'День знакомства', date: '2019-04-14', createdAt: now, updatedAt: now, version: 1 }
    ];

    state.history = [
      {
        calendarDate: '2026-10-20', circleId: c, dayIndex: 2,
        date: '20 октября', question: 'За что ты благодарен сегодня?',
        category: 'Близость',
        answers: {
          a: { text: 'За тихий вечер вместе.' },
          b: { text: 'За то, что мы слушаем друг друга.' }
        },
        reaction: { value: '❤️' }
      }
    ];
    state.completedDays = Math.max(state.completedDays || 0, 3);
    state.streak = Math.max(state.streak || 0, 3);
  }`);
}

// ——— Ritual / garden shots (01–08) ———
await clearStore();
await page.waitForSelector('#start-form', { timeout: 20000 });
await shot(OUT, '01-onboarding');

await page.fill('input[name="name"]', 'Дима');
await page.fill('input[name="partnerName"]', 'Катя');
await page.click('#start-form button[type="submit"]');
await page.waitForSelector('.tabbar', { timeout: 15000 });
// Seed a short streak so the chip is not an empty «0»
await patchState(`function (state) {
  state.streak = Math.max(state.streak || 0, 4);
  state.completedDays = Math.max(state.completedDays || 0, 4);
}`);
await page.waitForTimeout(400);
await shot(OUT, '02-today');

await unlockLab();
await nav('garden');
await page.waitForSelector('[data-start-theme]', { timeout: 10000 });
await shot(OUT, '05-garden');

await page.click('[data-start-theme="zamioculcas"]');
await page.waitForSelector('#period-answer-form, .period-today', { timeout: 15000 });
await page.waitForTimeout(400);

// Backdate so first question is unlocked
await patchState(`function (state) {
  for (const p of state.periods || []) {
    if (p.status === 'active') p.startDate = '2025-01-01';
  }
}`);
await nav('today');
await page.waitForSelector('#period-answer-form', { timeout: 15000 });
await page.fill('#period-answer-text', 'Мне нравится, как мы поддерживаем друг друга в обычных днях.');
await page.evaluate(() => {
  const form = document.querySelector('#period-answer-form');
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});
await page.waitForSelector('text=Ждём Катя', { timeout: 15000 }).catch(() => null);
await page.waitForTimeout(500);
// Waiting copy uses partner name
if (!(await page.locator('text=Ждём').count())) {
  await page.waitForSelector('.waiting-card', { timeout: 10000 });
}
await shot(OUT, '03-waiting');

// Partner answer + theme history (both replies). Today jumps past mutual Q once answered.
const periodId = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('blizhe-pwa', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const g = tx.objectStore('kv').get('state');
    g.onsuccess = () => resolve((g.result?.periods || []).find((x) => x.status === 'active')?.id || null);
    g.onerror = () => reject(g.error);
  });
});

await patchState(`function (state) {
  const p = (state.periods || []).find((x) => x.status === 'active');
  if (!p) return;
  p.answers = p.answers || {};
  let qid = Object.keys(p.answers).find((id) => p.answers[id]?.a?.text);
  if (!qid) qid = p.contentSnapshot?.questions?.[0]?.id;
  if (!qid) return;
  p.answers[qid] = {
    ...(p.answers[qid] || {}),
    a: p.answers[qid]?.a || {
      text: 'Мне нравится, как мы поддерживаем друг друга в обычных днях.',
      submittedAt: new Date().toISOString()
    },
    b: {
      text: 'Мне тепло от того, что ты рядом даже в мелочах.',
      submittedAt: new Date().toISOString()
    }
  };
  p.updatedAt = new Date().toISOString();
  p.version = (p.version || 1) + 1;
}`);

await nav('garden');
if (periodId) await page.click(`[data-period-history="${periodId}"]`);
else await page.locator('[data-period-history]').first().click();
await page.waitForSelector('.flower-q .answers-grid, .answers-grid', { timeout: 15000 });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.flower-q')?.scrollIntoView({ block: 'start' }));
await shot(OUT, '04-reveal');

if (await page.locator('[data-garden-back]').count()) await page.click('[data-garden-back]');
else await nav('garden');
await page.waitForTimeout(700);
await shot(OUT, '05-garden');

await nav('history');
await page.waitForSelector('text=Как мы жили', { timeout: 10000 }).catch(() => null);
await page.waitForTimeout(300);
await shot(OUT, '06-history');

await nav('settings');
await page.waitForSelector('text=Настройки', { timeout: 10000 });
await page.evaluate(() => document.querySelector('.test-lab')?.setAttribute('hidden', ''));
if (await page.locator('[data-nav="packs"]').count()) {
  await page.click('[data-nav="packs"]');
} else {
  await page.goto(`${BASE}/?screen=packs`, { waitUntil: 'networkidle' });
}
await page.waitForSelector('text=Ближе Плюс', { timeout: 10000 });
await shot(OUT, '07-plus');

await nav('settings');
await page.waitForSelector('text=Настройки', { timeout: 10000 });
await page.evaluate(() => document.querySelector('.test-lab')?.setAttribute('hidden', ''));
await shot(OUT, '08-settings');

// ——— Archive / “new” product shots ———
await seedArchiveDemo();

await nav('ours');
await page.waitForSelector('text=Что мы хотим', { timeout: 10000 });
await shot(OUT_NEW, 'ours');

const wishId = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-nav="list"][data-list]')].find((n) =>
    /Хотелки/.test(n.textContent || '')
  );
  return el?.getAttribute('data-list') || null;
});
if (wishId) await page.click(`[data-nav="list"][data-list="${wishId}"]`);
await page.waitForTimeout(500);
await shot(OUT_NEW, 'wishlist');

await nav('ours');
await page.waitForTimeout(300);
const placesId = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-nav="list"][data-list]')].find((n) =>
    /Куда сходить/.test(n.textContent || '')
  );
  return el?.getAttribute('data-list') || null;
});
if (placesId) await page.click(`[data-nav="list"][data-list="${placesId}"]`);
await page.waitForTimeout(500);
await shot(OUT_NEW, 'places');

await nav('moments');
await page.waitForSelector('text=Ваша жизнь', { timeout: 10000 });
await shot(OUT_NEW, 'moments');

await page.click('[data-nav="moment"][data-moment="mom-1"]');
await page.waitForTimeout(600);
await shot(OUT_NEW, 'moment');
await shot(OUT_NEW, 'moment-photos');

await page.goto(
  `${BASE}/?screen=share&url=${encodeURIComponent('https://example.com/tea')}&title=${encodeURIComponent('Чайный набор')}`,
  { waitUntil: 'networkidle' }
);
await page.waitForSelector('.tabbar', { timeout: 15000 });
await page.waitForTimeout(500);
await shot(OUT_NEW, 'share');

await nav('history');
await page.waitForTimeout(400);
await shot(OUT_NEW, 'history');
await shot(OUT_NEW, 'timeline');

await nav('settings');
await page.evaluate(() => document.querySelector('.test-lab')?.setAttribute('hidden', ''));
// Scroll to photos / link block if present
const photoHead = page.locator('text=Фото').first();
if (await photoHead.count()) {
  await photoHead.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await shot(OUT_NEW, 'photos');
} else {
  await shot(OUT_NEW, 'photos');
}
await page.locator('#settings-link').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await shot(OUT_NEW, 'link-settings');

await page.click('#pair-create');
await page.waitForSelector('.pair-code', { timeout: 15000 });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.test-lab')?.setAttribute('hidden', ''));
await page.locator('.pair-code').scrollIntoViewIfNeeded();
await shot(OUT_NEW, 'pair-code');

// Tab icon crop (brand mark)
await page.setViewportSize({ width: 120, height: 120 });
await page.setContent(
  `<div style="margin:0;width:120px;height:120px;display:grid;place-items:center;background:linear-gradient(145deg,#6e52df,#9b6eff);border-radius:28px;color:#fff;font-size:54px;font-family:system-ui">♥</div>`
);
await page.screenshot({ path: resolve(OUT_NEW, 'tab-icon.png') });
console.log('saved tab-icon');

await browser.close();
console.log('screenshots ->', OUT, 'and', OUT_NEW);
