import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://127.0.0.1:4173';
const OUT = resolve('scripts/layout-shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'ru-RU' });
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  localStorage.clear();
  const dbs = await indexedDB.databases?.();
  if (dbs) await Promise.all(dbs.map((db) => db.name && indexedDB.deleteDatabase(db.name)));
});
await page.reload({ waitUntil: 'networkidle' });
await page.fill('input[name=name]', 'Дима');
await page.fill('input[name=partnerName]', 'Катя');
await page.click('button[type=submit]');
await page.waitForSelector('text=Время для вас двоих');
await page.waitForTimeout(900);

async function audit(label) {
  await page.screenshot({ path: resolve(OUT, `viewport-${label}.png`), fullPage: false });
  const data = await page.evaluate(() => {
    const tab = document.querySelector('.tabbar');
    const tr = tab?.getBoundingClientRect();
    const main = document.querySelector('.main-content');
    const mr = main?.getBoundingClientRect();
    const overlaps = [];
    document.querySelectorAll('button, a, input, textarea, .tab').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!tr || r.width < 1) return;
      const overlapY = Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top);
      const overlapX = Math.min(r.right, tr.right) - Math.max(r.left, tr.left);
      if (overlapY > 8 && overlapX > 8 && !el.closest('.tabbar')) {
        overlaps.push({
          text: (el.innerText || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').slice(0, 40),
          overlapY: Math.round(overlapY)
        });
      }
    });
    const overflowSpans = [...document.querySelectorAll('span')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        if (r.left >= -2 && r.right <= innerWidth + 2) return null;
        return {
          cls: el.className,
          parent: el.parentElement?.className,
          left: Math.round(r.left),
          right: Math.round(r.right),
          html: el.outerHTML.slice(0, 140)
        };
      })
      .filter(Boolean);
    const tabs = [...document.querySelectorAll('.tab small')].map((s) => ({
      label: s.textContent,
      truncated: s.scrollWidth > s.clientWidth + 1,
      clientW: s.clientWidth,
      scrollW: s.scrollWidth
    }));
    return {
      vh: innerHeight,
      vw: innerWidth,
      scrollW: document.documentElement.scrollWidth,
      hasHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      tabbar: tr
        ? {
            top: Math.round(tr.top),
            bottom: Math.round(tr.bottom),
            position: getComputedStyle(tab).position,
            dockedToBottom: Math.abs(tr.bottom - innerHeight) < 20 || tr.bottom <= innerHeight
          }
        : null,
      mainBottom: mr ? Math.round(mr.bottom) : null,
      appPaddingBottom: getComputedStyle(document.querySelector('.app-shell')).paddingBottom,
      interactiveOverlappingTabbar: overlaps.slice(0, 10),
      overflowSpans: overflowSpans.slice(0, 10),
      tabs,
      nudgeText: document.querySelector('.notification-nudge')?.innerText || null
    };
  });
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
  return data;
}

await audit('today');

for (const [nav, wait] of [
  ['garden', 'Сад отношений'],
  ['history', 'Наша история'],
  ['packs', 'Couple Plus'],
  ['settings', 'Настройки']
]) {
  await page.click(`[data-nav="${nav}"]`);
  await page.waitForSelector(`text=${wait}`);
  await page.waitForTimeout(200);
  await audit(nav);
}

// unlock lab + partner flow
const logo = page.locator('#brand-logo');
await logo.dispatchEvent('pointerdown');
await page.waitForTimeout(3200);
await logo.dispatchEvent('pointerup');
await page.click('[data-nav="settings"]');
await page.waitForSelector('#lab-trigger-partner');
await page.click('button.lab-delay[data-delay="3000"]');
await page.click('[data-nav="today"]');
await page.fill('#answer-text', 'Тест ответа для проверки вёрстки.');
await page.click('#answer-form button[type=submit]');
await page.waitForSelector('text=Ждём ответ партнёра');
await page.waitForTimeout(400);
await audit('waiting');

await page.click('[data-nav="settings"]');
await page.click('#lab-trigger-partner');
await page.click('[data-nav="today"]');
await page.waitForSelector('text=Ответы открыты');
await page.waitForTimeout(400);
await audit('reveal');

await page.click('#complete-day');
await page.waitForSelector('text=Сад отношений');
await page.waitForTimeout(400);
await audit('garden-filled');

await browser.close();

// narrow + long names: role switch crowding after Test Lab unlock
const browser2 = await chromium.launch({ headless: true });
const ctx2 = await browser2.newContext({
  ...devices['iPhone SE'],
  viewport: { width: 360, height: 640 },
  locale: 'ru-RU'
});
const page2 = await ctx2.newPage();
await page2.goto(BASE, { waitUntil: 'networkidle' });
await page2.evaluate(async () => {
  localStorage.clear();
  const dbs = await indexedDB.databases?.();
  if (dbs) await Promise.all(dbs.map((db) => db.name && indexedDB.deleteDatabase(db.name)));
});
await page2.reload({ waitUntil: 'networkidle' });
await page2.fill('input[name=name]', 'Александра');
await page2.fill('input[name=partnerName]', 'Константин');
await page2.click('button[type=submit]');
await page2.waitForSelector('text=Время для вас двоих');
const logo2 = page2.locator('#brand-logo');
await logo2.dispatchEvent('pointerdown');
await page2.waitForTimeout(3200);
await logo2.dispatchEvent('pointerup');
await page2.waitForTimeout(300);
await page2.screenshot({ path: resolve(OUT, 'viewport-narrow-roles.png'), fullPage: false });
const roleInfo = await page2.evaluate(() => {
  const rs = document.querySelector('.role-switch');
  const brand = document.querySelector('.brand');
  if (!rs) return { roleSwitch: null };
  const rr = rs.getBoundingClientRect();
  const br = brand.getBoundingClientRect();
  const buttons = [...rs.querySelectorAll('button')].map((b) => ({
    text: b.textContent,
    w: Math.round(b.getBoundingClientRect().width),
    truncated: b.scrollWidth > b.clientWidth + 1
  }));
  return {
    roleSwitch: { left: Math.round(rr.left), right: Math.round(rr.right), w: Math.round(rr.width) },
    brand: { right: Math.round(br.right) },
    gap: Math.round(rr.left - br.right),
    buttons,
    overlapBrand: rr.left < br.right - 2
  };
});
console.log('\n=== narrow long names role switch ===');
console.log(JSON.stringify(roleInfo, null, 2));
await browser2.close();
