import { chromium, devices } from 'playwright';

async function check(name, contextOptions) {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ ...contextOptions, locale: 'ru-RU' })).newPage();
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        localStorage.clear();
        const req = indexedDB.deleteDatabase('blizhe-pwa');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
        setTimeout(resolve, 1000);
      })
  );
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.$('input[name=name]')) {
    await page.fill('input[name=name]', 'Дима');
    await page.fill('input[name=partnerName]', 'Катя');
    await page.click('button[type=submit]');
  }
  await page.waitForSelector('#answer-form button[type=submit]');
  await page.waitForTimeout(600);

  // dismiss toast if any by waiting
  await page.waitForTimeout(2500);

  const atTop = await measure(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  const atBottom = await measure(page);
  await page.screenshot({ path: `scripts/layout-shots/cta-${name}-bottom.png`, fullPage: false });

  console.log(`\n=== ${name} ===`);
  console.log('atTop', JSON.stringify(atTop, null, 2));
  console.log('atBottom', JSON.stringify(atBottom, null, 2));
  await browser.close();
}

async function measure(page) {
  return page.evaluate(() => {
    const cta = document.querySelector('#answer-form button[type=submit]');
    const tab = document.querySelector('.tabbar');
    const shell = document.querySelector('.app-shell');
    const cr = cta.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    const overlap = Math.min(cr.bottom, tr.bottom) - Math.max(cr.top, tr.top);
    const cs = getComputedStyle(cta);
    const shellCs = getComputedStyle(shell);
    return {
      scrollY: Math.round(scrollY),
      cta: {
        top: Math.round(cr.top),
        bottom: Math.round(cr.bottom),
        position: cs.position,
        bottomCss: cs.bottom,
        z: cs.zIndex
      },
      tab: { top: Math.round(tr.top), bottom: Math.round(tr.bottom), z: getComputedStyle(tab).zIndex },
      overlapPx: Math.round(overlap),
      ctaUnderTabbar: overlap > 8,
      shellOverflow: shellCs.overflow,
      shellOverflowY: shellCs.overflowY,
      vh: innerHeight
    };
  });
}

await check('iphone14', devices['iPhone 14']);
await check('desktop', {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false
});
await check('iphoneSE', devices['iPhone SE']);
