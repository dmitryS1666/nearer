import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('scripts/layout-shots/garden');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices['iPhone 14'], locale: 'ru-RU' });
const page = await context.newPage();

async function hardClear() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        localStorage.clear();
        const req = indexedDB.deleteDatabase('blizhe-pwa');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
        setTimeout(resolve, 800);
      })
  );
  await page.reload({ waitUntil: 'networkidle' });
}

async function onboardAndUnlock() {
  await page.fill('input[name=name]', 'Дима');
  await page.fill('input[name=partnerName]', 'Катя');
  await page.click('button[type=submit]');
  await page.waitForSelector('.tabbar');
  const logo = page.locator('#brand-logo');
  await logo.dispatchEvent('pointerdown');
  await page.waitForTimeout(3200);
  await logo.dispatchEvent('pointerup');
  await page.waitForTimeout(250);
}

async function bumpToDays(target) {
  await page.click('[data-nav="garden"]');
  await page.waitForSelector('.milestones');
  let cur = Number((await page.locator('.milestones').innerText()).match(/(\d+)/)?.[1] || 0);
  while (cur < target) {
    await page.click('[data-nav="settings"]');
    await page.waitForSelector('#lab-garden');
    await page.click('#lab-garden');
    await page.waitForSelector('.garden-stage');
    const next = cur + 1;
    const stageUp = [2, 5, 9, 14, 21].includes(next);
    if (next === target) {
      await page.waitForTimeout(stageUp ? 160 : 100);
      await page.screenshot({
        path: resolve(OUT, `${String(target).padStart(2, '0')}-day-anim.png`),
        fullPage: false
      });
      await page.waitForTimeout(stageUp ? 900 : 650);
    } else {
      await page.waitForTimeout(120);
    }
    cur = Number((await page.locator('.milestones').innerText()).match(/Завершённых дней:\s*(\d+)/)?.[1] || next);
  }
  await page.screenshot({
    path: resolve(OUT, `${String(target).padStart(2, '0')}-day.png`),
    fullPage: false
  });
  const info = await page.evaluate(() => ({
    stage: document.querySelector('.garden-stage')?.getAttribute('aria-label'),
    icon: document.querySelector('.garden-stage')?.textContent?.trim(),
    phrase: document.querySelector('.garden-card p')?.textContent?.trim(),
    days: document.querySelector('.milestones')?.innerText?.replace(/\s+/g, ' '),
    tabOk: (() => {
      const t = document.querySelector('.tabbar').getBoundingClientRect();
      return t.bottom <= innerHeight + 1 && t.top > innerHeight * 0.65;
    })(),
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  }));
  console.log(`day ${target}`, JSON.stringify(info));
}

await hardClear();
await onboardAndUnlock();

for (const d of [0, 1, 2, 5, 9, 14, 21]) {
  if (d === 0) {
    await page.click('[data-nav="garden"]');
    await page.waitForSelector('.garden-stage');
    await page.screenshot({ path: resolve(OUT, '00-day.png'), fullPage: false });
    const info = await page.evaluate(() => ({
      stage: document.querySelector('.garden-stage')?.getAttribute('aria-label'),
      icon: document.querySelector('.garden-stage')?.textContent?.trim(),
      phrase: document.querySelector('.garden-card p')?.textContent?.trim()
    }));
    console.log('day 0', JSON.stringify(info));
    continue;
  }
  await bumpToDays(d);
}

// Desktop CTA overlap check after fix
const desk = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'ru-RU'
});
const dpage = await desk.newPage();
await dpage.goto(BASE, { waitUntil: 'networkidle' });
await dpage.evaluate(
  () =>
    new Promise((resolve) => {
      localStorage.clear();
      const req = indexedDB.deleteDatabase('blizhe-pwa');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
      setTimeout(resolve, 800);
    })
);
await dpage.reload({ waitUntil: 'networkidle' });
await dpage.fill('input[name=name]', 'Дима');
await dpage.fill('input[name=partnerName]', 'Катя');
await dpage.click('button[type=submit]');
await dpage.waitForSelector('#answer-form button');
await dpage.waitForTimeout(800);
await dpage.evaluate(() => window.scrollTo(0, 0));
const cta = await dpage.evaluate(() => {
  const ctaEl = document.querySelector('#answer-form button[type=submit]');
  const tab = document.querySelector('.tabbar');
  const cr = ctaEl.getBoundingClientRect();
  const tr = tab.getBoundingClientRect();
  const overlap = Math.min(cr.bottom, tr.bottom) - Math.max(cr.top, tr.top);
  return {
    overlap: Math.round(overlap),
    ctaUnderTabbar: overlap > 8,
    sticky: getComputedStyle(ctaEl).position,
    shellOverflow: getComputedStyle(document.querySelector('.app-shell')).overflowY
  };
});
console.log('desktop CTA after fix', cta);
await dpage.screenshot({ path: resolve(OUT, 'desktop-today-cta.png'), fullPage: false });

await browser.close();
console.log('done ->', OUT);
