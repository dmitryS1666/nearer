import { chromium, devices } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ ...devices['iPhone 14'], locale: 'ru-RU' })).newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
const clear = await page.evaluate(
  () =>
    new Promise((resolve) => {
      localStorage.clear();
      const req = indexedDB.deleteDatabase('blizhe-pwa');
      req.onsuccess = () => resolve('ok');
      req.onerror = () => resolve('err');
      req.onblocked = () => resolve('blocked');
    })
);
console.log('clear', clear);
await page.reload({ waitUntil: 'networkidle' });
await page.fill('input[name=name]', 'Дима');
await page.fill('input[name=partnerName]', 'Катя');
await page.click('button[type=submit]');
await page.waitForSelector('#answer-text');
const logo = page.locator('#brand-logo');
await logo.dispatchEvent('pointerdown');
await page.waitForTimeout(3200);
await logo.dispatchEvent('pointerup');
await page.click('[data-nav=settings]');
await page.waitForSelector('#lab-trigger-partner');
await page.click('button.lab-delay[data-delay="3000"]');
await page.click('[data-nav=today]');
await page.waitForSelector('#answer-text');
await page.fill('#answer-text', 'Тест ответа для проверки верстки.');
await page.click('#answer-form button[type=submit]');
await page.waitForTimeout(800);
const after = await page.locator('body').innerText();
console.log({
  hasWaiting: /Жд[её]м/.test(after),
  hasReveal: after.includes('Ответы открыты'),
  hasAnswerForm: Boolean(await page.$('#answer-text')),
  hasComplete: Boolean(await page.$('#complete-day')),
  snippet: after.replace(/\s+/g, ' ').slice(0, 400)
});
await page.screenshot({ path: 'scripts/layout-shots/debug-after-submit.png', fullPage: false });
await browser.close();
