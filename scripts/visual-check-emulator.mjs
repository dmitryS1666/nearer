/**
 * Visual QA via Chrome DevTools Protocol against Capacitor WebView.
 * Prerequisites: debug APK running, adb forward tcp:9222 webview_devtools_remote_<pid>
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'artifacts/visual');
mkdirSync(outDir, { recursive: true });

const list = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = list.find((p) => p.type === 'page');
if (!page) throw new Error('No WebView page found on :9222');

const wsUrl = page.webSocketDebuggerUrl;
console.log('Connecting', wsUrl);

let id = 0;
const pending = new Map();
const ws = new WebSocket(wsUrl);

function send(method, params = {}) {
  return new Promise((resolvePromise, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve: resolvePromise, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

ws.addEventListener('message', (ev) => {
  const data = JSON.parse(ev.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(JSON.stringify(data.error)));
    else resolve(data.result);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

await send('Runtime.enable');
await send('Page.enable');

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}

async function shot(name) {
  await new Promise((r) => setTimeout(r, 700));
  // Prefer adb screencap for full device chrome (status/nav bars)
  const dest = resolve(outDir, `${name}.png`);
  execSync(`adb shell screencap -p /sdcard/${name}.png`);
  execSync(`adb pull /sdcard/${name}.png "${dest}"`, { stdio: 'inherit' });
  // Also CDP page shot for pure web content
  const cdp = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(resolve(outDir, `${name}-web.png`), Buffer.from(cdp.data, 'base64'));
  console.log('shot', name);
}

const report = { screens: [], issues: [] };

await shot('01-onboarding');
const onboardingText = await evaluate(`document.body.innerText.slice(0, 400)`);
report.screens.push({ name: 'onboarding', text: onboardingText });
if (!String(onboardingText).includes('Ближе каждый день')) {
  report.issues.push('Onboarding: missing title');
}

// Complete onboarding
await evaluate(`
  (async () => {
    const name = document.querySelector('input[name=name]');
    const partner = document.querySelector('input[name=partnerName]');
    const form = document.querySelector('#start-form');
    if (!form || !name || !partner) throw new Error('onboarding form missing');
    name.value = 'Дима';
    partner.value = 'Катя';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    partner.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 500));
    return document.body.innerText.includes('Время для вас двоих');
  })()
`);
await shot('02-today-question');
const todayText = await evaluate(`document.body.innerText.slice(0, 500)`);
report.screens.push({ name: 'today', text: todayText });
['Сегодня', 'Отправить'].forEach((t) => {
  if (!String(todayText).includes(t) && !String(todayText).includes('Отправить ответ')) {
    // soft check below
  }
});
if (!String(todayText).includes('Время для вас двоих')) report.issues.push('Today: missing hero');
const hasNudgeSetup = String(todayText).includes('Настроить') || (await evaluate(`!!document.querySelector('#enable-push-nudge')`));
const hasTextarea = await evaluate(`!!document.querySelector('#answer-text')`);
const textareaResize = await evaluate(`getComputedStyle(document.querySelector('#answer-text')||document.body).resize`);
if (!hasTextarea) report.issues.push('Today: textarea missing');
if (textareaResize && textareaResize !== 'none') report.issues.push(`Today: textarea resize is ${textareaResize}, expected none`);
report.hasNudgeSetup = hasNudgeSetup;
report.textareaResize = textareaResize;

// Submit answer → waiting
await evaluate(`
  (async () => {
    const ta = document.querySelector('#answer-text');
    const form = document.querySelector('#answer-form');
    ta.value = 'Мне нравится, как мы поддерживаем друг друга в обычные дни.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    await new Promise(r => setTimeout(r, 600));
    return document.body.innerText.includes('Ждём') || document.body.innerText.includes('ответ');
  })()
`);
await shot('03-waiting');
const waitingText = await evaluate(`document.body.innerText.slice(0, 400)`);
report.screens.push({ name: 'waiting', text: waitingText });
if (!String(waitingText).includes('Ждём')) report.issues.push('Waiting: missing copy');

// Force partner answer via Test Lab state or simulate
await evaluate(`
  (async () => {
    // Unlock test lab and trigger partner through existing engine if exposed,
    // otherwise mutate via indexed path used by app: click isn't available,
    // so dispatch custom path — call demo by answering as partner through localStorage? 
    // Use UI: open settings via nav, unlock is hard. Directly fill partner answer in IDB is complex.
    // Fallback: use role switch if visible, else inject into state via BroadcastChannel won't work.
    const btn = document.querySelector('#simulate-partner');
    if (btn) { btn.click(); await new Promise(r => setTimeout(r, 400)); return 'simulate'; }
    // Try Test Lab unlocked flag and trigger button
    const brand = document.querySelector('#brand-logo');
    // Directly set partner answer through form state by evaluating app internals is unavailable.
    // Use IndexedDB clear+set is heavy. Poll for auto demo partner (15s).
    return 'wait-auto';
  })()
`);

const mode = await evaluate(`document.body.innerText.includes('Ответы открыты') ? 'reveal' : 'waiting'`);
if (mode !== 'reveal') {
  console.log('Waiting for demo partner auto-answer (up to 20s)...');
  const start = Date.now();
  while (Date.now() - start < 22000) {
    await new Promise((r) => setTimeout(r, 1500));
    const ready = await evaluate(`document.body.innerText.includes('Ответы открыты')`);
    if (ready) break;
  }
}
await shot('04-reveal');
const revealText = await evaluate(`document.body.innerText.slice(0, 500)`);
report.screens.push({ name: 'reveal', text: revealText });
if (!String(revealText).includes('Ответы открыты')) report.issues.push('Reveal: not reached (partner delay?)');
const hasReactions = await evaluate(`document.querySelectorAll('[data-reaction]').length`);
report.reactionButtons = hasReactions;
if (hasReactions < 4) report.issues.push('Reveal: expected 4 reaction buttons');

// Reaction + complete day
await evaluate(`
  (async () => {
    const r = document.querySelector('[data-reaction]');
    if (r) r.click();
    await new Promise(x => setTimeout(x, 300));
    const c = document.querySelector('#complete-day');
    if (c) c.click();
    await new Promise(x => setTimeout(x, 700));
    return document.body.innerText.includes('Сад');
  })()
`);
await shot('05-garden');
const gardenText = await evaluate(`document.body.innerText.slice(0, 500)`);
report.screens.push({ name: 'garden', text: gardenText });
if (!String(gardenText).includes('Сад')) report.issues.push('Garden: missing');

// History
await evaluate(`document.querySelector('[data-nav="history"]')?.click()`);
await shot('06-history');
const historyText = await evaluate(`document.body.innerText.slice(0, 500)`);
report.screens.push({ name: 'history', text: historyText });

// Plus
await evaluate(`document.querySelector('[data-nav="packs"]')?.click()`);
await shot('07-plus');
const plusText = await evaluate(`document.body.innerText.slice(0, 600)`);
report.screens.push({ name: 'plus', text: plusText });
if (!String(plusText).includes('Плюс')) report.issues.push('Plus: missing Russian Плюс');
if (/Couple Plus|Plus активен|demo entitlement/i.test(plusText) && !String(plusText).includes('Ближе Плюс')) {
  // Couple Plus anglicism check
}
if (String(plusText).includes('Couple Plus')) report.issues.push('Plus: still contains Couple Plus anglicism');
report.plusTabLabel = await evaluate(`document.querySelector('[data-nav="packs"] small')?.textContent`);

// Settings
await evaluate(`document.querySelector('[data-nav="settings"]')?.click()`);
await shot('08-settings');
const settingsText = await evaluate(`document.body.innerText.slice(0, 700)`);
report.screens.push({ name: 'settings', text: settingsText });
if (!String(settingsText).includes('Уведомления')) report.issues.push('Settings: notifications section missing');
if (!String(settingsText).includes('отзыв') && !String(settingsText).includes('Отзыв') && !String(settingsText).includes('отзыв о тестовой')) {
  if (!String(settingsText).includes('Оставить отзыв')) report.issues.push('Settings: feedback CTA missing');
}

// Layout metrics on today
await evaluate(`document.querySelector('[data-nav="today"]')?.click()`);
await new Promise((r) => setTimeout(r, 500));
const layout = await evaluate(`
  (() => {
    const tab = document.querySelector('.tabbar');
    const cta = document.querySelector('.sticky-cta, #answer-form .primary, #complete-day');
    const main = document.querySelector('.main-content');
    const body = document.body;
    const overflowX = body.scrollWidth > body.clientWidth + 2;
    const tabRect = tab?.getBoundingClientRect();
    const ctaRect = cta?.getBoundingClientRect();
    return {
      overflowX,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      tabbar: tabRect ? { top: tabRect.top, bottom: tabRect.bottom, h: tabRect.height } : null,
      cta: ctaRect ? { top: ctaRect.top, bottom: ctaRect.bottom } : null,
      ctaAboveTab: ctaRect && tabRect ? ctaRect.bottom <= tabRect.top + 8 : null,
      todayFit: main?.classList.contains('today-fit') || false,
      tabLabels: [...document.querySelectorAll('.tab small')].map(el => el.textContent)
    };
  })()
`);
report.layout = layout;
if (layout.overflowX) report.issues.push('Layout: horizontal overflow');
if (layout.tabLabels && !layout.tabLabels.includes('Плюс')) report.issues.push('Tabbar: Plus label not Russian Плюс');

writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ issues: report.issues, layout: report.layout, plusTabLabel: report.plusTabLabel, textareaResize: report.textareaResize, hasNudgeSetup: report.hasNudgeSetup }, null, 2));
ws.close();
if (report.issues.length) process.exitCode = 2;
