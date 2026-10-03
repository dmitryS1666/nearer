import { chromium, devices } from 'playwright';
import { resolve } from 'node:path';

async function hardClear(page) {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    // close any open connections by reloading after delete
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('blizhe-pwa');
      let done = false;
      const finish = (v) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      req.onsuccess = () => finish('ok');
      req.onerror = () => finish('err');
      req.onblocked = () => finish('blocked');
      setTimeout(() => finish('timeout'), 2000);
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  // if still onboarded, force another clear+reload
  const onboarded = await page.evaluate(() => !!document.querySelector('[data-nav="today"], .tabbar'));
  if (onboarded) {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase('blizhe-pwa');
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
          setTimeout(resolve, 1500);
        })
    );
    await page.reload({ waitUntil: 'networkidle' });
  }
}

async function runViewport(name, device) {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ ...device, locale: 'ru-RU' })).newPage();
  await hardClear(page);

  const issues = [];
  const note = (sev, msg) => {
    issues.push({ name, sev, msg });
    console.log(`[${sev}] ${name}: ${msg}`);
  };

  // onboarding
  if (!(await page.$('text=Ближе каждый день'))) {
    note('high', 'Onboarding not shown after clear — stale state');
  } else {
    await page.screenshot({ path: resolve(`scripts/layout-shots/final-${name}-onboarding.png`), fullPage: false });
    await page.fill('input[name=name]', name.includes('long') ? 'Александра' : 'Дима');
    await page.fill('input[name=partnerName]', name.includes('long') ? 'Константин' : 'Катя');
    await page.click('button[type=submit]');
  }
  await page.waitForSelector('.tabbar', { timeout: 10000 });
  if (name.includes('long')) {
    const logo = page.locator('#brand-logo');
    await logo.dispatchEvent('pointerdown');
    await page.waitForTimeout(3200);
    await logo.dispatchEvent('pointerup');
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(`scripts/layout-shots/final-${name}-today.png`), fullPage: false });

  const metrics = await page.evaluate(() => {
    const tab = document.querySelector('.tabbar');
    const tr = tab.getBoundingClientRect();
    const brand = document.querySelector('.brand')?.getBoundingClientRect();
    const topQuiet = document.querySelector('.top-quiet, .role-switch')?.getBoundingClientRect();
    const ghost = (() => {
      // sample pixel just above tabbar center for content bleed isn't easy without canvas;
      // report tabbar opacity/background instead
      const cs = getComputedStyle(tab);
      return { bg: cs.backgroundColor, backdrop: cs.backdropFilter || cs.webkitBackdropFilter };
    })();
    return {
      hasHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      tabDocked: tr.bottom <= innerHeight + 1 && tr.top > innerHeight * 0.7,
      brandVisible: brand ? brand.top >= 0 && brand.bottom > 0 : false,
      topRight: topQuiet
        ? {
            text: document.querySelector('.top-quiet, .role-switch')?.innerText?.replace(/\s+/g, ' '),
            truncated: [...(document.querySelectorAll('.role-switch button, .top-quiet span') || [])].some(
              (el) => el.scrollWidth > el.clientWidth + 1
            ),
            overlapsBrand: brand ? topQuiet.left < brand.right - 2 : false
          }
        : null,
      tabbarStyle: ghost,
      tabsTruncated: [...document.querySelectorAll('.tab small')].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent)
    };
  });

  if (metrics.hasHScroll) note('high', 'Horizontal scroll');
  if (!metrics.tabDocked) note('high', 'Tabbar not docked to bottom of viewport');
  if (!metrics.brandVisible) note('medium', 'Brand not visible in first viewport');
  if (metrics.topRight?.overlapsBrand) note('high', 'Role switch / top-quiet overlaps brand');
  if (metrics.topRight?.truncated) note('medium', `Top-right text truncated: ${metrics.topRight.text}`);
  if (metrics.tabsTruncated.length) note('medium', `Tab labels truncated: ${metrics.tabsTruncated.join(', ')}`);
  if (metrics.tabbarStyle.bg.includes('rgba') || metrics.tabbarStyle.bg.endsWith(', 0.925)') || /ec$/i.test(metrics.tabbarStyle.bg)) {
    note('low', `Tabbar semi-transparent (${metrics.tabbarStyle.bg}) — content may show through`);
  }

  // answer -> waiting -> check soft bar overflow
  if (await page.$('#answer-text')) {
    await page.fill('#answer-text', 'Короткий ответ для проверки экрана ожидания.');
    await page.click('#answer-form button[type=submit]');
    await page.waitForSelector('text=Ждём ответ партнёра', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(`scripts/layout-shots/final-${name}-waiting.png`), fullPage: false });
    const soft = await page.evaluate(() => {
      const span = document.querySelector('.waiting-soft-bar span');
      if (!span) return null;
      const r = span.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, causesHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    if (soft && soft.left < -2 && !soft.causesHScroll) {
      note('low', `waiting-soft-bar animates off-screen (left=${soft.left}) but no page H-scroll`);
    } else if (soft?.causesHScroll) {
      note('high', 'waiting-soft-bar causes horizontal page scroll');
    }
  }

  console.log(name, JSON.stringify(metrics, null, 2));
  await browser.close();
  return issues;
}

const all = [];
all.push(
  ...(await runViewport('iphone14', devices['iPhone 14'])),
  ...(await runViewport('desktop', {
    userAgent: 'Mozilla/5.0',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  })),
  ...(await runViewport('narrow-longnames', {
    ...devices['iPhone SE'],
    viewport: { width: 360, height: 740 }
  }))
);

console.log('\nALL ISSUES', JSON.stringify(all, null, 2));
