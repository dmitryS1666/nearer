import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4193;
const vite = await createServer({
  configFile: resolve(root, 'pwa/vite.config.js'),
  server: { host: '127.0.0.1', port: PORT, strictPort: true }
});
await vite.listen();
const browser = await chromium.launch({ headless: true, channel: process.env.E2E_CHROME_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#start-form');
  assert.equal(await page.locator('#release-notes').count(), 0);
  await page.fill('input[name="name"]', 'Аня');
  await page.fill('input[name="partnerName"]', 'Боря');
  await page.click('#start-form button[type="submit"]');
  await page.waitForSelector('#release-title');
  const text = await page.locator('#release-notes').innerText();
  assert.match(text, /0\.2\.0/);
  assert.match(text, /Клавиатура больше не прячется/);
  assert.match(text, /вашим именем/);
  await page.click('#release-ok');
  await page.waitForSelector('#release-notes', { state: 'detached' });
  await page.reload();
  await page.waitForSelector('.tabbar');
  assert.equal(await page.locator('#release-notes').count(), 0);
  console.log('PASS release notes show once');
} finally {
  await browser.close();
  await vite.close();
}
