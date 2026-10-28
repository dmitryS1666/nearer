/**
 * Smoke: install banner appears for deferred beforeinstallprompt and iOS Safari tip.
 * Usage: PWA_URL=http://127.0.0.1:4173 node scripts/check-pwa-install.mjs
 */
import { chromium } from 'playwright';

const base = process.env.PWA_URL || 'http://127.0.0.1:4173';

async function completeOnboarding(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  const form = page.locator('#start-form');
  if (await form.count()) {
    await form.locator('input[name="name"]').fill('Аня');
    await form.locator('input[name="partnerName"]').fill('Макс');
    await form.locator('button[type="submit"]').click();
    await page.waitForSelector('.dashboard-head, .tabbar', { timeout: 8000 });
  }
}

async function fireDeferredPrompt(page) {
  await page.evaluate(() => {
    localStorage.removeItem('blizhe-install-dismissed');
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperty(event, 'prompt', {
      value: async () => {},
      configurable: true
    });
    Object.defineProperty(event, 'userChoice', {
      value: Promise.resolve({ outcome: 'dismissed' }),
      configurable: true
    });
    window.dispatchEvent(event);
  });
  await page.waitForTimeout(250);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.E2E_CHROME_CHANNEL || 'chrome'
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await completeOnboarding(page);

  if (!(await page.locator('#install-nudge').isHidden())) {
    throw new Error('install nudge should be hidden before prompt');
  }

  await fireDeferredPrompt(page);
  if (!(await page.locator('#install-nudge').isVisible())) {
    throw new Error('install nudge should show after beforeinstallprompt');
  }
  const cta = await page.locator('#install-nudge-cta').textContent();
  if (!/Установить/i.test(cta || '')) throw new Error(`unexpected CTA: ${cta}`);

  await page.locator('#install-nudge-dismiss').click();
  await page.waitForTimeout(200);
  if (!(await page.locator('#install-nudge').isHidden())) {
    throw new Error('install nudge should hide after dismiss');
  }

  await page.locator('button[data-nav="settings"], .icon-btn[aria-label="Настройки"]').first().click();
  await page.waitForSelector('#settings-install', { timeout: 5000 });
  if (!(await page.locator('#settings-install-btn').isVisible())) {
    throw new Error('settings install button missing with deferred prompt');
  }

  const iosContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  await iosContext.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => false });
    try {
      localStorage.removeItem('blizhe-install-dismissed');
    } catch {
      // ignore
    }
  });
  const ios = await iosContext.newPage();
  await completeOnboarding(ios);
  await ios.waitForTimeout(300);
  if (!(await ios.locator('#install-nudge').isVisible())) {
    throw new Error('iOS Safari should show install tip');
  }
  const iosText = await ios.locator('#install-nudge-text').textContent();
  if (!/Поделиться|Домой/i.test(iosText || '')) throw new Error(`bad iOS tip: ${iosText}`);

  await browser.close();
  console.log('check-pwa-install=PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
