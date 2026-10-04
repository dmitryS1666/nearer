import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'docs/screenshots');
const BASE = process.env.PWA_URL || 'http://127.0.0.1:4173';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({
    ...devices['iPhone 14'],
    locale: 'ru-RU'
  })
).newPage();

async function clearStore() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
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
}

async function shot(name) {
  await page.evaluate(() => {
    const root = document.getElementById('toast-root');
    if (root) root.innerHTML = '';
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
  console.log('saved', name);
}

async function unlockLab() {
  const logo = page.locator('#brand-logo');
  await logo.dispatchEvent('pointerdown');
  await page.waitForTimeout(3200);
  await logo.dispatchEvent('pointerup');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const root = document.getElementById('toast-root');
    if (root) root.innerHTML = '';
  });
}

await clearStore();
await shot('01-onboarding');

await page.fill('input[name=name]', 'Дима');
await page.fill('input[name=partnerName]', 'Катя');
await page.click('button[type=submit]');
await page.waitForSelector('text=Время для вас двоих');
await page.waitForTimeout(900);
await shot('02-today');

await unlockLab();
await page.click('[data-nav="settings"]');
await page.waitForSelector('#lab-trigger-partner');
await page.click('button.lab-delay[data-delay="3000"]');
await page.evaluate(() => {
  const root = document.getElementById('toast-root');
  if (root) root.innerHTML = '';
});

await page.click('[data-nav="today"]');
await page.waitForSelector('#answer-text');
await page.fill('#answer-text', 'Мне нравится, как мы поддерживаем друг друга.');
await page.click('#answer-form button[type=submit]');
await page.waitForSelector('text=Ждём ответ партнёра');
await shot('03-waiting');

await page.click('[data-nav="settings"]');
await page.click('#lab-trigger-partner');
await page.click('[data-nav="today"]');
await page.waitForSelector('text=Ответы открыты');
await page.waitForTimeout(500);
// Frame both answers + reactions in the mobile viewport
await page.evaluate(() => {
  const root = document.getElementById('toast-root');
  if (root) root.innerHTML = '';
  document.querySelector('.reveal-section')?.scrollIntoView({ block: 'start' });
  // Hide bulky dashboard head for a cleaner product shot of the reveal
  const head = document.querySelector('.dashboard-head');
  const nudge = document.querySelector('.notification-nudge');
  if (head) head.style.display = 'none';
  if (nudge) nudge.style.display = 'none';
});
await page.waitForTimeout(300);
await shot('04-reveal');

// Reaction then garden — clean product loop for README
await page.evaluate(() => {
  const head = document.querySelector('.dashboard-head');
  const nudge = document.querySelector('.notification-nudge');
  if (head) head.style.display = '';
  if (nudge) nudge.style.display = '';
});
await page.click('[data-reaction="❤️"]');
await page.waitForTimeout(350);
await page.evaluate(() => {
  const root = document.getElementById('toast-root');
  if (root) root.innerHTML = '';
});
await page.click('#complete-day');
await page.waitForSelector('text=Сад отношений');
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const root = document.getElementById('toast-root');
  if (root) root.innerHTML = '';
  document.querySelector('.garden-card')?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(250);
await shot('05-garden');

await page.click('[data-nav="history"]');
await page.waitForSelector('text=Наша история');
await shot('06-history');

await page.click('[data-nav="packs"]');
await page.waitForSelector('text=Ближе Плюс');
await shot('07-plus');

await page.click('[data-nav="settings"]');
await page.waitForSelector('text=Настройки');
await page.evaluate(() => {
  const root = document.getElementById('toast-root');
  if (root) root.innerHTML = '';
  // hide test lab for cleaner screenshot if present
  document.querySelector('.test-lab')?.setAttribute('hidden', '');
});
await shot('08-settings');

await browser.close();
console.log('screenshots ->', OUT);
