import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('scripts/layout-shots/garden');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ ...devices['iPhone 14'], locale: 'ru-RU' })).newPage();

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
await page.fill('input[name=name]', 'Дима');
await page.fill('input[name=partnerName]', 'Катя');
await page.click('button[type=submit]');
await page.waitForSelector('.tabbar');
const logo = page.locator('#brand-logo');
await logo.dispatchEvent('pointerdown');
await page.waitForTimeout(3200);
await logo.dispatchEvent('pointerup');

const clearToasts = async () => {
  await page.evaluate(() => {
    const root = document.getElementById('toast-root');
    if (root) root.innerHTML = '';
  });
};

const goDays = async (target) => {
  let cur = 0;
  await page.click('[data-nav="garden"]');
  const m = await page.locator('.milestones').innerText().catch(() => '');
  cur = Number(m.match(/Завершённых дней:\s*(\d+)/)?.[1] || 0);
  while (cur < target) {
    await page.click('[data-nav="settings"]');
    await page.click('#lab-garden');
    await page.waitForSelector('.garden-stage');
    cur += 1;
  }
  await clearToasts();
};

for (const [days, name] of [
  [0, 'clean-00-seed'],
  [2, 'clean-02-sprout'],
  [5, 'clean-05-young'],
  [9, 'clean-09-flower'],
  [14, 'clean-14-garden'],
  [21, 'clean-21-mature']
]) {
  await goDays(days);
  await page.waitForTimeout(200);
  await clearToasts();
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
  console.log(name, await page.locator('.garden-stage').getAttribute('aria-label'));
}

// Capture stage-up animation: from 1 -> 2 (seed to sprout)
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
await page.fill('input[name=name]', 'Дима');
await page.fill('input[name=partnerName]', 'Катя');
await page.click('button[type=submit]');
await page.waitForSelector('.tabbar');
const logo2 = page.locator('#brand-logo');
await logo2.dispatchEvent('pointerdown');
await page.waitForTimeout(3200);
await logo2.dispatchEvent('pointerup');
await goDays(1);
await clearToasts();
await page.click('[data-nav="settings"]');
await page.click('#lab-garden'); // 1 -> 2 stage-up
await page.waitForTimeout(150);
await clearToasts();
await page.screenshot({ path: resolve(OUT, 'clean-stageup-mid.png'), fullPage: false });
await page.waitForTimeout(900);
await clearToasts();
await page.screenshot({ path: resolve(OUT, 'clean-stageup-end.png'), fullPage: false });

await browser.close();
console.log('clean shots ready');
