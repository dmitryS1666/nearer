import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.PWA_URL || 'http://127.0.0.1:4173';
const OUT = resolve('scripts/layout-shots');
mkdirSync(OUT, { recursive: true });

const findings = [];

function note(screen, viewport, severity, message, extra = {}) {
  findings.push({ screen, viewport, severity, message, ...extra });
  console.log(`[${severity}] ${viewport}/${screen}: ${message}`);
}

async function collectOverflow(page) {
  return page.evaluate(() => {
    const vw = innerWidth;
    const issues = [];
    const ignore = (el) =>
      el.classList?.contains('aurora') ||
      el.classList?.contains('toast') ||
      el.closest?.('.aurora, .toast-root');
    document.querySelectorAll('body *').forEach((el) => {
      if (ignore(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (r.right > vw + 2) {
        issues.push({
          type: 'overflow-right',
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 80),
          right: Math.round(r.right),
          vw,
          text: String(el.innerText || '').replace(/\s+/g, ' ').slice(0, 50)
        });
      }
      if (r.left < -2) {
        issues.push({
          type: 'overflow-left',
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 80),
          left: Math.round(r.left),
          text: String(el.innerText || '').replace(/\s+/g, ' ').slice(0, 50)
        });
      }
    });
    const seen = new Set();
    return issues.filter((i) => {
      const k = `${i.type}|${i.tag}|${i.cls}|${i.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 25);
  });
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const stylesOk = [...document.styleSheets].reduce((n, s) => {
      try { return n + (s.cssRules?.length || 0); } catch { return n; }
    }, 0);
    const tabbar = document.querySelector('.tabbar');
    const tr = tabbar?.getBoundingClientRect();
    const tabs = [...document.querySelectorAll('.tab')].map((t) => {
      const r = t.getBoundingClientRect();
      const small = t.querySelector('small');
      return {
        label: small?.textContent || '',
        w: Math.round(r.width),
        h: Math.round(r.height),
        truncated: small ? small.scrollWidth > small.clientWidth + 1 : false
      };
    });
    return {
      stylesOk,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      clientW: document.documentElement.clientWidth,
      hasHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      tabbar: tr
        ? { top: Math.round(tr.top), bottom: Math.round(tr.bottom), w: Math.round(tr.width), visible: tr.bottom > 0 && tr.top < innerHeight }
        : null,
      tabs,
      bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0]
    };
  });
}

async function shot(page, name) {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function checkScreen(page, viewportName, screenName) {
  const overflows = await collectOverflow(page);
  const metrics = await layoutMetrics(page);
  await shot(page, `${viewportName}-${screenName}`);

  if (metrics.stylesOk < 10) {
    note(screenName, viewportName, 'critical', `CSS not applied (rules=${metrics.stylesOk})`);
  }
  if (metrics.hasHScroll) {
    note(screenName, viewportName, 'high', `Horizontal scroll (scrollW=${metrics.scrollW}, clientW=${metrics.clientW})`);
  }
  for (const o of overflows) {
    note(screenName, viewportName, 'high', `Element overflow: ${o.type} ${o.tag}.${o.cls} "${o.text}"`, { detail: o });
  }
  if (metrics.tabbar) {
    if (!metrics.tabbar.visible) {
      note(screenName, viewportName, 'medium', 'Tabbar not in viewport');
    }
    for (const t of metrics.tabs) {
      if (t.truncated) note(screenName, viewportName, 'medium', `Tab label truncated: ${t.label}`);
      if (t.w < 40) note(screenName, viewportName, 'medium', `Tab too narrow (${t.w}px): ${t.label}`);
    }
  }
  return metrics;
}

async function unlockTestLab(page) {
  const logo = page.locator('#brand-logo');
  await logo.dispatchEvent('pointerdown');
  await page.waitForTimeout(3200);
  await logo.dispatchEvent('pointerup');
  await page.waitForTimeout(200);
}

async function runFlow(context, viewportName) {
  const page = await context.newPage();
  page.on('pageerror', (e) => note('runtime', viewportName, 'high', `pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases?.();
    if (dbs) {
      await Promise.all(dbs.map((db) => db.name && indexedDB.deleteDatabase(db.name)));
    }
  });
  await page.reload({ waitUntil: 'networkidle' });

  // Onboarding
  await page.waitForSelector('text=Ближе каждый день');
  await checkScreen(page, viewportName, 'onboarding');
  await page.fill('input[name=name]', 'Дима');
  await page.fill('input[name=partnerName]', 'Катя');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Время для вас двоих');
  await page.waitForTimeout(400);

  // Today - answer form
  await checkScreen(page, viewportName, 'today-answer');

  // Visit secondary screens before day completes (empty/partial states)
  await page.click('[data-nav="garden"]');
  await page.waitForSelector('text=Сад отношений');
  await checkScreen(page, viewportName, 'garden-empty');

  await page.click('[data-nav="history"]');
  await page.waitForSelector('text=Наша история');
  await checkScreen(page, viewportName, 'history-empty');

  await page.click('[data-nav="packs"]');
  await page.waitForSelector('text=Couple Plus');
  await checkScreen(page, viewportName, 'packs');

  await page.click('[data-nav="settings"]');
  await page.waitForSelector('text=Настройки');
  await checkScreen(page, viewportName, 'settings');

  // Unlock Test Lab via long-press brand, set 3s delay, answer, trigger partner
  await unlockTestLab(page);
  await page.click('[data-nav="settings"]');
  await page.waitForSelector('#lab-trigger-partner');
  await checkScreen(page, viewportName, 'settings-testlab');
  await page.click('button.lab-delay[data-delay="3000"]');

  await page.click('[data-nav="today"]');
  await page.waitForSelector('#answer-text');
  await page.fill('#answer-text', 'Мне нравится, как мы поддерживаем друг друга каждый день.');
  await page.click('#answer-form button[type=submit]');
  await page.waitForSelector('text=Ждём ответ партнёра');
  await checkScreen(page, viewportName, 'today-waiting');

  // Prefer explicit Test Lab trigger for speed/stability
  await page.click('[data-nav="settings"]');
  await page.waitForSelector('#lab-trigger-partner');
  await page.click('#lab-trigger-partner');
  await page.click('[data-nav="today"]');
  await page.waitForSelector('text=Ответы открыты', { timeout: 15000 });
  await checkScreen(page, viewportName, 'today-reveal');

  await page.click('#complete-day');
  await page.waitForSelector('text=Сад отношений');
  await checkScreen(page, viewportName, 'garden');

  await page.click('[data-nav="history"]');
  await page.waitForSelector('text=Наша история');
  await checkScreen(page, viewportName, 'history');

  await page.click('[data-nav="today"]');
  await page.waitForTimeout(300);
  await checkScreen(page, viewportName, 'today-done');

  // Role switch layout (Test Lab unlocked)
  const roleSwitch = page.locator('.role-switch');
  if (await roleSwitch.count()) {
    await checkScreen(page, viewportName, 'today-roles');
  }

  await page.close();
}

const browser = await chromium.launch({ headless: true });

const viewports = [
  { name: 'iphone14', device: devices['iPhone 14'] },
  { name: 'iphone-se', device: devices['iPhone SE'] },
  {
    name: 'pixel5',
    device: {
      ...devices['Pixel 5'],
      viewport: { width: 393, height: 851 }
    }
  },
  {
    name: 'desktop',
    device: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false
    }
  },
  {
    name: 'narrow360',
    device: {
      userAgent: devices['iPhone SE'].userAgent,
      viewport: { width: 360, height: 740 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    }
  }
];

for (const vp of viewports) {
  console.log(`\n=== ${vp.name} ===`);
  const context = await browser.newContext({
    ...vp.device,
    locale: 'ru-RU'
  });
  try {
    await runFlow(context, vp.name);
  } catch (err) {
    note('flow', vp.name, 'critical', `Flow failed: ${err.message}`);
    console.error(err);
  }
  await context.close();
}

await browser.close();

const summary = {
  base: BASE,
  out: OUT,
  counts: {
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length
  },
  findings
};
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(summary, null, 2));
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary.counts, null, 2));
console.log(`Report: ${resolve(OUT, 'report.json')}`);
if (summary.counts.critical || summary.counts.high) process.exitCode = 1;
