/**
 * Background sync must not destroy a focused answer field.
 * npm run test:e2e:drafts
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4188;

const vite = await createServer({
  configFile: resolve(root, 'pwa/vite.config.js'),
  server: { host: '127.0.0.1', port: PORT, strictPort: true }
});
await vite.listen();

const browser = await chromium.launch({
  headless: true,
  channel: process.env.E2E_CHROME_CHANNEL || 'chrome'
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#start-form', { timeout: 20000 });
  await page.fill('input[name="name"]', 'Аня');
  await page.fill('input[name="partnerName"]', 'Боря');
  await page.click('#start-form button[type="submit"]');
  await page.waitForSelector('#answer-text, #period-answer-text', { state: 'attached', timeout: 15000 });
  const field = (await page.locator('#period-answer-text').count()) ? '#period-answer-text' : '#answer-text';
  if (field === '#answer-text') {
    const summary = page.locator('summary', { hasText: 'Ещё один вопрос' });
    if (await summary.count()) await summary.click();
  }
  await page.waitForSelector(field, { state: 'visible', timeout: 10000 });
  await page.locator(field).click();
  await page.locator(field).fill('черновик который нельзя потерять');
  const before = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return { id: document.activeElement?.id, value: el?.value, start: el?.selectionStart };
  }, field);
  assert.equal(before.id, field.slice(1));
  assert.equal(before.value, 'черновик который нельзя потерять');
  await page.evaluate(() => window.__nearerBackgroundRender());
  const after = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return {
      id: document.activeElement?.id,
      value: el?.value,
      connected: Boolean(el?.isConnected)
    };
  }, field);
  assert.equal(after.connected, true);
  assert.equal(after.id, field.slice(1));
  assert.equal(after.value, 'черновик который нельзя потерять');
  await page.locator(field).press('End');
  await page.locator(field).type(' 123');
  await page.evaluate(() => window.__nearerBackgroundRender());
  const typed = await page.locator(field).inputValue();
  assert.equal(typed, 'черновик который нельзя потерять 123');
  console.log('PASS draft focus survives background render');
} finally {
  await browser.close();
  await vite.close();
}
