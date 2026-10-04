import { config } from './config.js';
import { getValue, setValue } from './platform/storage.js';
import { runtime, setupServiceWorker } from './platform/runtime.js';
import { NotificationService } from './platform/notifications.js';
import { lightImpact } from './platform/haptics.js';
import { shareText, openExternalUrl } from './platform/sharing.js';
import { configureStatusBar } from './platform/statusBar.js';
import {
  coupleRepository,
  initialState,
  gardenFromCompletedDays,
  streakMilestone,
  calendarDateString
} from './domain/LocalCoupleRepository.js';
import { DemoPartnerEngine } from './domain/DemoPartnerEngine.js';
import { DemoEntitlementProvider } from './domain/DemoEntitlementProvider.js';
import { userSession } from './domain/UserSession.js';
import {
  initAnalytics,
  track,
  buildExportPayload,
  getInstallId
} from './domain/analytics.js';
import { decorateQuestion } from './domain/questions.js';
import './styles.css';

let state = structuredClone(initialState);
let screen = new URLSearchParams(location.search).get('screen') || 'today';
let installPrompt = null;
let versionTapCount = 0;
let versionTapTimer = null;
let gardenAnim = null; // { type: 'grow' | 'stage-up', stageId }
let lastError = null;
let revealAnimatedForKey = null;
let pendingSettingsFocus = null;

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('blizhe-couple') : null;
const app = document.getElementById('app');
const toastRoot = document.getElementById('toast-root');

const entitlement = new DemoEntitlementProvider(
  () => state.plus,
  async (v) => {
    state.plus = v;
    await saveState();
  }
);

const demoPartner = new DemoPartnerEngine({
  getState: () => ({ ...state, todayKey: todayKey() }),
  saveAnswerForRole: async (dayKey, role, text, meta = {}) => {
    state.answers[dayKey] = {
      ...(state.answers[dayKey] || {}),
      [role]: { text, submittedAt: new Date().toISOString(), ...meta }
    };
    await saveState();
  },
  onPartnerAnswered: async () => {
    if (bothAnswered() && state.notificationPrefs.reveal) {
      await NotificationService.sendDebugNotification({
        title: 'Ответы открыты ❤️',
        body: 'Можно посмотреть ответы друг друга.',
        url: '/?screen=today',
        tag: 'reveal'
      });
    }
    render();
  }
});

const roleLabel = () => (state.currentRole === 'a' ? state.profile.name : state.profile.partnerName);
const partnerRole = () => (state.currentRole === 'a' ? 'b' : 'a');
const todayKey = () => coupleRepository.todayKey(state);
const todayQuestion = () => decorateQuestion(coupleRepository.getTodayQuestion(state));
const todayAnswers = () => state.answers[todayKey()] || {};
const bothAnswered = () => Boolean(todayAnswers().a?.text && todayAnswers().b?.text);
const meAnswered = () => Boolean(todayAnswers()[state.currentRole]?.text);
const partnerAnswered = () => Boolean(todayAnswers()[partnerRole()]?.text);

let uiIconSeq = 0;
function uiIcon(name) {
  const gid = `ui${++uiIconSeq}`;
  if (name === 'bell') {
    return `<svg class="ui-icon ui-icon-bell" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${gid}" x1="8" y1="4" x2="24" y2="28" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFE08A"/><stop offset="1" stop-color="#F5B94A"/>
      </linearGradient></defs>
      <path fill="url(#${gid})" d="M16 3.5c-4.2 0-7.6 3.3-7.6 7.4v3.2c0 1.5-.5 2.9-1.5 4.1l-.7.8c-.7.8-.2 2.1.9 2.1h17.8c1.1 0 1.6-1.3.9-2.1l-.7-.8c-1-1.2-1.5-2.6-1.5-4.1V10.9c0-4.1-3.4-7.4-7.6-7.4z"/>
      <path fill="#F0C35A" d="M12.2 24.2a3.9 3.9 0 0 0 7.6 0H12.2z"/>
      <circle cx="16" cy="7.2" r="1.3" fill="#FFF3C8" opacity=".85"/>
    </svg>`;
  }
  if (name === 'flame') {
    return `<svg class="ui-icon ui-icon-flame" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${gid}" x1="10" y1="28" x2="22" y2="4" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FF6B3D"/><stop offset=".55" stop-color="#FF8F3A"/><stop offset="1" stop-color="#FFC857"/>
      </linearGradient></defs>
      <path fill="url(#${gid})" d="M16.2 3.2c.4 3.2-1.2 5.1-3.3 7.1-2.3 2.2-4.7 4.5-4.7 8.2 0 4.4 3.5 7.5 7.8 7.5s7.8-3.1 7.8-7.5c0-3.2-1.4-5.3-3.2-7.2-.7-.8-1.4-1.5-1.9-2.4-.3 1.6-1.2 2.8-2.5 3.8 1.1-3.2.4-5.8 0-9.5z"/>
      <path fill="#FFE29A" d="M16 14.6c.2 1.5-.5 2.4-1.4 3.3-1 1-2 2-2 3.6 0 2 1.5 3.4 3.4 3.4s3.4-1.4 3.4-3.4c0-1.4-.6-2.3-1.4-3.2-.4-.4-.8-.8-1.1-1.3-.1.7-.5 1.2-1 1.7.5-1.4.2-2.6.1-4.1z"/>
    </svg>`;
  }
  if (name === 'heart') {
    return `<svg class="ui-icon ui-icon-heart" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${gid}" x1="6" y1="8" x2="26" y2="26" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F48BB0"/><stop offset="1" stop-color="#C46BE8"/>
      </linearGradient></defs>
      <path fill="url(#${gid})" d="M16 27.2s-9.4-5.8-11.8-11.1C2.6 12.4 4.2 8 8.3 7.2c2.2-.4 4.2.7 5.4 2.4 1.2-1.7 3.2-2.8 5.4-2.4 4.1.8 5.7 5.2 4.1 8.9C25.4 21.4 16 27.2 16 27.2z"/>
      <path fill="#FFE3F0" opacity=".55" d="M10.2 10.1c1.3-.8 2.9-.5 3.9.7-.9.7-1.5 1.6-1.8 2.7-1.4-1.1-2.6-2.3-2.1-3.4z"/>
    </svg>`;
  }
  if (name === 'letter') {
    return `<svg class="ui-icon ui-icon-letter" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="4.5" y="8" width="23" height="16.5" rx="3.5" fill="#EFE8FF"/>
      <path d="M6.2 10.2 16 16.4l9.8-6.2" fill="none" stroke="#8B6FE0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="4.5" y="8" width="23" height="16.5" rx="3.5" fill="none" stroke="#B9A4F0" stroke-width="1.6"/>
    </svg>`;
  }
  return '';
}

function daysInARowLabel(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день подряд';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'дня подряд';
  return 'дней подряд';
}

function hasNotificationPrefsEnabled() {
  const prefs = state.notificationPrefs || {};
  return Boolean(prefs.daily || prefs.partner || prefs.reveal || prefs.streak);
}

function streakBubble() {
  const label = daysInARowLabel(state.streak);
  return `<div class="streak-bubble" aria-label="Серия: ${state.streak} ${label}">${uiIcon('flame')}<div class="streak-meta"><b>${state.streak}</b><small>${label}</small></div></div>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[ch]);
}

function toast(message, kind = 'default') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2600);
}

async function saveState(broadcast = true) {
  await coupleRepository.saveState(state);
  if (broadcast) channel?.postMessage({ type: 'STATE', state });
}

async function loadState() {
  state = await coupleRepository.loadState();
  coupleRepository.ensureTodayQuestion(state);
  const role = sessionStorage.getItem('blizhe-role');
  if (role === 'a' || role === 'b') state.currentRole = role;
}

function setRole(role) {
  state.currentRole = role;
  sessionStorage.setItem('blizhe-role', role);
  render();
}

function nav(to) {
  screen = to;
  const url = new URL(location.href);
  url.searchParams.set('screen', to);
  history.replaceState({}, '', url);
  if (to === 'garden') track('garden_viewed');
  if (to === 'history') track('history_viewed');
  if (to === 'packs') track('plus_viewed');
  render();
}

function showErrorScreen(err) {
  lastError = err;
  app.innerHTML = `
    <div class="error-boundary">
      <div class="error-card">
        <div class="error-icon">💜</div>
        <h1>Что-то пошло не так.</h1>
        <p>Можно перезапустить экран и продолжить. Ваши локальные данные обычно сохраняются.</p>
        <button class="primary large" id="reload-screen">Перезапустить экран</button>
        ${state.testLabUnlocked ? `<pre class="error-debug">${escapeHtml(String(err?.stack || err?.message || err))}</pre>` : ''}
      </div>
    </div>`;
  document.getElementById('reload-screen')?.addEventListener('click', () => {
    lastError = null;
    render();
  });
}

function shell(content, active = screen) {
  const showRoles = state.testLabUnlocked;
  const fitClass = active === 'today' ? ' today-fit' : '';
  return `
    <div class="aurora aurora-one"></div><div class="aurora aurora-two"></div>
    <header class="topbar">
      <button class="brand" data-nav="today" aria-label="На главную" id="brand-logo"><span class="brand-mark">♥</span><span>Ближе</span></button>
      ${
        showRoles
          ? `<div class="role-switch">
        <button data-role="a" class="${state.currentRole === 'a' ? 'active' : ''}">${escapeHtml(state.profile.name)}</button>
        <button data-role="b" class="${state.currentRole === 'b' ? 'active' : ''}">${escapeHtml(state.profile.partnerName)}</button>
      </div>`
          : `<div class="top-quiet"><span>для двоих</span></div>`
      }
    </header>
    <main class="main-content${fitClass}">${content}</main>
    <nav class="tabbar" aria-label="Основная навигация">
      ${tabButton('today', '♡', 'Сегодня', active)}
      ${tabButton('garden', '♧', 'Сад', active)}
      ${tabButton('history', '◷', 'История', active)}
      ${tabButton('packs', '✦', 'Плюс', active)}
      ${tabButton('settings', '⚙', 'Настройки', active)}
    </nav>`;
}

function tabButton(id, icon, label, active) {
  return `<button data-nav="${id}" class="tab ${active === id ? 'active' : ''}"><span>${icon}</span><small>${label}</small></button>`;
}

function renderOnboarding() {
  track('onboarding_started');
  app.innerHTML = `
  <div class="onboarding-page">
    <div class="onboarding-visual">
      <div class="orbit orbit-a">💜</div><div class="orbit orbit-b">✨</div>
      <div class="hero-heart">♥</div>
    </div>
    <section class="onboarding-card">
      <div class="eyebrow">Ежедневный ритуал</div>
      <h1>Ближе каждый день.</h1>
      <p class="lead">Один вопрос. Два честных ответа. Маленький ритуал, который помогает не терять друг друга в обычных днях.</p>
      <div class="feature-row"><span>🔒</span><div><b>Приватно</b><small>Данные остаются на этом устройстве.</small></div></div>
      <div class="feature-row"><span>💬</span><div><b>1 вопрос в день</b><small>Без бесконечной ленты и перегруза.</small></div></div>
      <div class="feature-row"><span>🌱</span><div><b>Общий прогресс</b><small>Каждый завершённый день растит ваш сад.</small></div></div>
      <form id="start-form" class="onboarding-form">
        <label>Как зовут тебя?<input name="name" maxlength="24" value="" placeholder="Твоё имя" required></label>
        <label>Как зовут партнёра?<input name="partnerName" maxlength="24" value="" placeholder="Имя партнёра" required></label>
        <button class="primary large" type="submit">Начать <span>→</span></button>
      </form>
      <p class="microcopy">Тестовая версия хранит данные локально и не синхронизирует их с другим человеком.</p>
    </section>
  </div>`;
  document.getElementById('start-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    state.profile.name = String(fd.get('name') || 'Ты').trim();
    state.profile.partnerName = String(fd.get('partnerName') || 'Партнёр').trim();
    state.onboarded = true;
    coupleRepository.ensureTodayQuestion(state);
    await saveState();
    await track('onboarding_completed');
    toast('Добро пожаловать 💜');
    render();
  });
}

function todayView() {
  const q = todayQuestion();
  const answers = todayAnswers();
  let body = '';
  const dayDone = state.lastCompletedCalendarDate === todayKey();

  if (dayDone) {
    body = `
      <section class="waiting-card glass-card">
        <div class="pulse-heart">🌱</div>
        <div class="pill">День завершён</div>
        <h2>До завтра</h2>
        <p>Вы уже прожили сегодняшний ритуал. Загляните в сад или историю — новый вопрос появится завтра.</p>
        <div class="button-row wrap" style="justify-content:center">
          <button class="primary" data-nav="garden">Открыть сад</button>
          <button class="secondary" data-nav="history">История</button>
        </div>
        <div class="streak-inline">🔥 ${state.streak} дней вместе</div>
      </section>`;
  } else if (!meAnswered()) {
    track('question_viewed', { questionId: q.id, category: q.category });
    body = `
      <section class="question-card glass-card">
        <div class="question-meta"><span class="pill">${escapeHtml(q.categoryLabel)}</span><span>Сегодня</span></div>
        <h2>${escapeHtml(q.text)}</h2>
        <p class="question-note">Ответ партнёра откроется только после твоего ответа.</p>
        <form id="answer-form">
          <textarea id="answer-text" maxlength="700" rows="4" placeholder="Напиши то, что действительно хочется сказать…" enterkeyhint="done"></textarea>
          <div class="textarea-footer"><span id="char-count">0 / 700</span><span>Черновик сохраняется</span></div>
          <button class="primary large full sticky-cta" type="submit">Отправить ответ <span>♥</span></button>
        </form>
      </section>`;
  } else if (!partnerAnswered()) {
    track('waiting_viewed');
    body = `
      <section class="waiting-card glass-card">
        <div class="pulse-heart">♥</div>
        <div class="pill">Ответ отправлен ❤️</div>
        <h2>Ждём ответ партнёра</h2>
        <p>Мы не показываем ответы по одному — момент открытия должен быть общим.</p>
        <div class="waiting-orbit">
          <div>Ты ✓</div><span class="waiting-dots"><i></i><i></i><i></i></span>
          <div>${escapeHtml(state.profile.partnerName)} …</div>
        </div>
        <div class="waiting-soft-bar" aria-hidden="true"><span></span></div>
      </section>`;
  } else {
    track('reveal_viewed', { questionId: q.id });
    const key = todayKey();
    body = `
      <section class="reveal-section ${revealAnimatedForKey === key ? '' : 'reveal-enter'}">
        <div class="reveal-heading"><div class="confetti">✦</div><div><div class="eyebrow">Ответы открыты</div><h2>${escapeHtml(q.text)}</h2></div></div>
        <div class="answers-grid">
          ${answerCard(state.profile.name, answers.a?.text, 'violet')}
          ${answerCard(state.profile.partnerName, answers.b?.text, 'rose')}
        </div>
        <div class="reaction-row">
          <span class="reaction-label">Оставить реакцию:</span>
          <div class="reaction-actions" role="group" aria-label="Реакции">
          ${['❤️', '🥹', '😂', '🤗']
            .map(
              (r) =>
                `<button type="button" class="reaction ${state.reactions[key] === r ? 'active' : ''}" data-reaction="${r}" aria-label="Реакция ${r}"><span class="reaction-emoji">${r}</span></button>`
            )
            .join('')}
          </div>
        </div>
        <div class="completion-card">
          <div><span class="completion-icon">🌱</span><div><b>Ваш сад растёт</b><small>Завершите день, чтобы сохранить его в историю.</small></div></div>
          <button class="primary" id="complete-day">Завершить день →</button>
        </div>
        ${
          streakMilestone(state.streak)
            ? ''
            : state.streak > 0
              ? `<div class="streak-inline">🔥 ${state.streak} дней вместе</div>`
              : ''
        }
      </section>`;
  }

  return shell(`
    <section class="dashboard-head">
      <div class="dashboard-copy"><div class="eyebrow">Сегодня · ${escapeHtml(roleLabel())}</div><h1>Время для&nbsp;вас двоих</h1><p class="today-lead">Пять минут внимания важнее ещё одного уведомления.</p></div>
      ${streakBubble()}
    </section>
    ${notificationNudge()}
    ${body}
  `);
}

function answerCard(name, text, tone) {
  return `<article class="answer-card ${tone}"><div class="avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div><div><span>${escapeHtml(name)}</span><p>${escapeHtml(text)}</p></div></article>`;
}

function isReminderNudgeDismissed(permissionStatus) {
  // Hide after the user actually configures reminders in Settings,
  // or when the OS already blocks / doesn't support notifications.
  return (
    Boolean(state.reminderConfigured) ||
    hasNotificationPrefsEnabled() ||
    permissionStatus === 'denied' ||
    permissionStatus === 'unsupported'
  );
}

function notificationNudge() {
  // Start hidden; refreshNotificationNudge reveals only if still needed.
  // [hidden] must win over .notification-nudge { display:flex } via CSS.
  return `<section class="notification-nudge" id="notif-nudge" hidden>
    <div class="nudge-main">
      <span class="nudge-icon" aria-hidden="true">${uiIcon('bell')}</span>
      <div class="nudge-copy">
        <b>Не пропускайте ежедневный вопрос</b>
        <small>Мягкое напоминание в выбранное время.</small>
      </div>
    </div>
    <button class="ghost" id="enable-push-nudge" type="button">Настроить</button>
  </section>`;
}

function remainingDaysPhrase(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `Ещё ${n} совместный день до следующего этапа.`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `Ещё ${n} совместных дня до следующего этапа.`;
  return `Ещё ${n} совместных дней до следующего этапа.`;
}

function triggerGardenAnim(prevCompletedDays, nextCompletedDays) {
  const prev = gardenFromCompletedDays(prevCompletedDays);
  const next = gardenFromCompletedDays(nextCompletedDays);
  gardenAnim = {
    type: prev.stage.id !== next.stage.id ? 'stage-up' : 'grow',
    stageId: next.stage.id
  };
  setTimeout(() => {
    if (gardenAnim?.stageId === next.stage.id) gardenAnim = null;
  }, 1200);
}

function gardenView() {
  const garden = gardenFromCompletedDays(state.completedDays);
  const stage = garden.stage;
  const animClass =
    gardenAnim?.stageId === stage.id
      ? gardenAnim.type === 'stage-up'
        ? 'garden-stage-up'
        : 'garden-grow'
      : '';
  const remaining = garden.next ? Math.max(0, garden.next.minDays - state.completedDays) : 0;
  return shell(
    `
    <section class="page-head"><div class="dashboard-copy"><div class="eyebrow">Ваше общее пространство</div><h1>Сад отношений</h1><p>Он растёт не от идеальных ответов, а от регулярного внимания друг к другу.</p></div>${streakBubble()}</section>
    <section class="garden-card glass-card">
      <div class="sky-stars">✦ · ✧ · ✦</div>
      <div class="garden-stage ${animClass}" aria-label="${escapeHtml(stage.name)}">${stage.icon}</div>
      <h2>${escapeHtml(stage.name)}</h2>
      <p>${!garden.next ? 'Ваш сад уже стал настоящим маленьким миром.' : remainingDaysPhrase(remaining)}</p>
      <div class="progress-track"><div class="progress-bar" style="width:${garden.progress}%"></div></div>
      <div class="milestones"><span>Завершённых дней: <b>${state.completedDays}</b></span><span>Этап: <b>${escapeHtml(stage.name)}</b></span></div>
    </section>
    <section class="stats-grid">
      <div class="stat-card">${uiIcon('letter')}<div class="stat-meta"><b>${state.history.length}</b><small>вопросов в истории</small></div></div>
      <div class="stat-card">${uiIcon('flame')}<div class="stat-meta"><b>${state.streak}</b><small>${daysInARowLabel(state.streak)}</small></div></div>
      <div class="stat-card">${uiIcon('heart')}<div class="stat-meta"><b>${Object.keys(state.reactions).length}</b><small>реакций к ответам</small></div></div>
    </section>
    <p class="microcopy garden-hint">Реакции ставят после открытия ответов — на экране «Сегодня», когда оба ответили.</p>
  `,
    'garden'
  );
}

function historyView() {
  const entries = [...state.history].reverse();
  const visible = state.plus ? entries : entries.slice(0, 30);
  return shell(
    `
    <section class="page-head"><div><div class="eyebrow">То, что остаётся</div><h1>Наша история</h1><p>Не архив сообщений, а маленькие моменты, на которые приятно оглянуться.</p></div></section>
    ${
      visible.length
        ? `<div class="timeline">${visible.map((item) => historyCard(item)).join('')}</div>`
        : `<section class="empty-state glass-card"><div>◷</div><h2>История только начинается</h2><p>После первого завершённого вопроса здесь появится ваша первая запись.</p><button class="primary" data-nav="today">Ответить сегодня →</button></section>`
    }
    ${
      !state.plus && state.history.length >= 2
        ? `<section class="soft-paywall"><div><b>Полная история — в «Ближе Плюс»</b><p>Больше тем, развитие сада и будущие воспоминания.</p></div><button class="ghost" data-nav="packs">Смотреть Плюс</button></section>`
        : ''
    }
  `,
    'history'
  );
}

function historyCard(item) {
  return `<article class="timeline-item">
    <div class="timeline-rail" aria-hidden="true"><span class="timeline-dot"></span></div>
    <div class="timeline-card">
      <div class="question-meta"><span class="history-date">${escapeHtml(item.date)}</span><span class="pill">${escapeHtml(item.category)}</span></div>
      <h3>${escapeHtml(item.question)}</h3>
      <div class="mini-answers">
        <div><b>${escapeHtml(state.profile.name)}</b><p>${escapeHtml(item.answers.a?.text || '—')}</p></div>
        <div><b>${escapeHtml(state.profile.partnerName)}</b><p>${escapeHtml(item.answers.b?.text || '—')}</p></div>
      </div>
      ${item.reaction ? `<div class="history-reaction">${item.reaction}</div>` : ''}
    </div>
  </article>`;
}

function packsView() {
  const packs = [
    ['💙', 'Глубокие разговоры', '50 вопросов', 'Спокойные вопросы о ценностях, поддержке и том, что обычно откладываем.'],
    ['🗺️', 'Приключения и мечты', '40 вопросов', 'Куда поехать, чему научиться и что однажды попробовать вместе.'],
    ['🔥', 'Близость', '35 вопросов', 'Более личные вопросы для пары, которая хочет говорить открытее.'],
    ['✈️', 'На расстоянии', '30 вопросов', 'Ритуалы и разговоры для отношений на расстоянии.']
  ];
  return shell(
    `
    <section class="plus-hero">
      <div class="eyebrow">Ближе Плюс</div><h1>Больше поводов узнавать друг друга</h1>
      <p>Полная история · Больше тематических вопросов · Специальные темы · Развитие сада · Будущие воспоминания</p>
      <div class="price"><b>${state.plus ? 'Плюс активен' : 'Ближе Плюс'}</b><span>${state.plus ? 'тестовый доступ' : 'в релизе — подписка'}</span></div>
      <button class="primary large" id="plus-cta">${state.plus ? 'Плюс уже отмечен' : 'Попробовать Плюс'}</button>
    </section>
    <div class="pack-grid">${packs
      .map(
        ([icon, title, count, desc]) =>
          `<article class="pack-card ${state.plus ? '' : 'locked'}"><span class="pack-icon">${icon}</span><div class="pack-copy"><small>${count}</small><h3>${title}</h3><p>${desc}</p></div><span class="lock">${state.plus ? '→' : '🔒'}</span></article>`
      )
      .join('')}</div>
  `,
    'packs'
  );
}

function settingsView() {
  const isNative = runtime.isNative();
  return shell(
    `
    <section class="page-head"><div><div class="eyebrow">Пара и напоминания</div><h1>Настройки</h1><p>Имена, уведомления и сведения о тестовой версии.</p></div></section>

    <section class="settings-card">
      <h2>Пара</h2>
      <label class="setting-field">Твоё имя<input id="name-setting" value="${escapeHtml(state.profile.name)}" maxlength="24"></label>
      <label class="setting-field">Имя партнёра<input id="partner-setting" value="${escapeHtml(state.profile.partnerName)}" maxlength="24"></label>
      <button class="secondary" id="save-names">Сохранить имена</button>
    </section>

    <section class="settings-card" id="settings-notifications">
      <h2>Уведомления</h2>
      ${prefToggle('daily', 'Ежедневный вопрос', 'Мягкое напоминание один раз в день')}
      ${prefToggle('partner', 'Партнёр ответил', 'Когда можно заходить дальше')}
      ${prefToggle('reveal', 'Ответы открыты', 'Когда оба ответа готовы')}
      ${prefToggle('streak', 'Серия под угрозой', 'Необязательное напоминание вечером')}
      <label class="setting-field inline">Время напоминания<input id="reminder-time" type="time" value="${state.reminderTime}"></label>
      <div class="button-row wrap" style="margin-top:12px">
        <button class="primary" id="enable-push">Разрешить уведомления</button>
        ${state.testLabUnlocked ? `<button class="secondary" id="test-notification">Тестовое уведомление</button>` : ''}
      </div>
      <p class="microcopy">${isNative ? 'Напоминания работают через локальные уведомления устройства.' : 'В браузере доступны уведомления страницы; фоновый push требует отдельной настройки.'}</p>
    </section>

    <section class="settings-card">
      <h2>О тестовой версии</h2>
      <p>Эта тестовая версия хранит данные локально на этом устройстве и не синхронизирует их с другим человеком.</p>
      <div class="diagnostic-list">
        <div><span>Версия</span><b id="version-tap">${config.appName} ${config.versionName}</b></div>
        <div><span>Сборка</span><b>${config.buildLabel}</b></div>
        <div><span>Платформа</span><b>${runtime.platform()}</b></div>
        <div><span>Отзывы</span><b>${escapeHtml(config.TEST_FEEDBACK_EMAIL || 'не задано')}</b></div>
      </div>
      <div class="button-row wrap">
        <button class="secondary" id="feedback-btn">Оставить отзыв о тестовой версии</button>
        <button class="secondary" id="about-privacy">Подробнее</button>
      </div>
    </section>

    <section class="settings-card danger-zone">
      <h2>Данные</h2>
      <p>Сброс удалит локальные ответы, историю и прогресс на этом устройстве.</p>
      <button class="danger" id="reset-demo">Сбросить демо-данные</button>
    </section>

    ${state.testLabUnlocked ? testLabView() : ''}
  `,
    'settings'
  );
}

function testLabView() {
  const delay = state.testLab?.partnerDelayMs || 15000;
  return `
    <section class="settings-card test-lab">
      <h2>Test Lab</h2>
      <p>Только для QA. Обычные тестеры сюда не попадают.</p>
      <div class="diagnostic-list">
        <div><span>Current role</span><b>${state.currentRole === 'a' ? 'Me' : 'Partner'}</b></div>
        <div><span>Calendar date</span><b>${state.calendarDate || '—'}</b></div>
        <div><span>Question</span><b>${state.questionId || '—'}</b></div>
        <div><span>Install id</span><b>${getInstallId() || '—'}</b></div>
      </div>
      <label class="toggle-row"><span><b>Partner auto-answer</b><small>on/off</small></span><input type="checkbox" id="lab-auto" ${state.testLab?.partnerAutoAnswer !== false ? 'checked' : ''}><i></i></label>
      <div class="button-row wrap">
        <button class="secondary lab-delay" data-delay="3000">Delay 3s</button>
        <button class="secondary lab-delay" data-delay="10000">Delay 10s</button>
        <button class="secondary lab-delay" data-delay="30000">Delay 30s</button>
      </div>
      <p class="microcopy">Текущая задержка: ${delay} ms</p>
      <div class="button-row wrap">
        <button class="secondary" id="lab-trigger-partner">Trigger partner answer</button>
        <button class="secondary" id="lab-trigger-reveal">Trigger reveal</button>
        <button class="secondary" id="lab-inc-streak">Increment streak</button>
        <button class="secondary" id="lab-break-streak">Break streak</button>
        <button class="secondary" id="lab-garden">Garden +1 day</button>
        <button class="secondary" id="lab-reset-today">Reset today's question</button>
        <button class="secondary" id="lab-next-day">Следующий тестовый день</button>
        <button class="secondary" id="lab-notif">Notification test</button>
        <button class="secondary" id="lab-export">Экспортировать тестовые данные</button>
        <button class="secondary" id="lab-role-me">Role: Me</button>
        <button class="secondary" id="lab-role-partner">Role: Partner</button>
        <button class="danger" id="lab-reset-all">Reset all app data</button>
      </div>
      <h3 class="lab-scenarios-title">Сценарии сада</h3>
      <p class="microcopy">Прогоните несколько дней подряд и смотрите этапы: Семя → Росток (2) → Молодое (5) → Цветение (9) → Маленький сад (14) → Зрелый (21).</p>
      <div class="button-row wrap">
        <button class="secondary" id="lab-scenario-sprout" type="button">До ростка (2 дня)</button>
        <button class="secondary" id="lab-scenario-young" type="button">До молодого (5)</button>
        <button class="secondary" id="lab-scenario-flower" type="button">До цветения (9)</button>
        <button class="secondary" id="lab-scenario-week" type="button">+7 совместных дней</button>
        <button class="secondary" id="lab-scenario-full-day" type="button">Полный день → сад</button>
        <button class="secondary" id="lab-scenario-reset-garden" type="button">Сбросить сад</button>
      </div>
      ${lastError ? `<pre class="error-debug">${escapeHtml(String(lastError?.stack || lastError))}</pre>` : ''}
    </section>`;
}

function prefToggle(key, title, subtitle) {
  return `<label class="toggle-row"><span><b>${title}</b><small>${subtitle}</small></span><input type="checkbox" data-pref="${key}" ${state.notificationPrefs[key] ? 'checked' : ''}><i></i></label>`;
}

function render() {
  try {
    if (!state.onboarded) return renderOnboarding();
    const views = {
      today: todayView,
      garden: gardenView,
      history: historyView,
      packs: packsView,
      settings: settingsView
    };
    app.innerHTML = (views[screen] || todayView)();
    bindCommon();
    bindScreen();
    refreshNotificationNudge();
    maybeHapticReveal();
  } catch (err) {
    console.error(err);
    showErrorScreen(err);
  }
}

function bindCommon() {
  document.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => nav(el.dataset.nav)));
  document.querySelectorAll('[data-role]').forEach((el) => el.addEventListener('click', () => setRole(el.dataset.role)));

  const logo = document.getElementById('brand-logo');
  let pressTimer = null;
  logo?.addEventListener('pointerdown', () => {
    pressTimer = setTimeout(async () => {
      state.testLabUnlocked = true;
      await saveState();
      toast('Test Lab открыт');
      if (screen === 'settings') render();
    }, 3000);
  });
  logo?.addEventListener('pointerup', () => clearTimeout(pressTimer));
  logo?.addEventListener('pointerleave', () => clearTimeout(pressTimer));
}

function bindScreen() {
  if (screen === 'today') bindToday();
  if (screen === 'packs') bindPlus();
  if (screen === 'settings') bindSettings();
}

function bindPlus() {
  document.getElementById('plus-cta')?.addEventListener('click', async () => {
    await track('plus_cta_clicked');
    await track('paywall_cta_clicked');
    if (state.plus) {
      toast('Плюс уже отмечен в тестовой версии');
      return;
    }
    alert('Это тестовая версия.\nВ релизе здесь будет подписка.');
    await entitlement.setDemoPlus(true);
    render();
  });
}

function bindToday() {
  const textarea = document.getElementById('answer-text');
  const draftKey = `draft-${state.currentRole}-${todayKey()}`;
  if (textarea) {
    track('answer_started', { questionId: state.questionId });
    getValue(draftKey, '').then((draft) => {
      textarea.value = draft || '';
      updateCount();
    });
    const updateCount = () => {
      const el = document.getElementById('char-count');
      if (el) el.textContent = `${textarea.value.length} / 700`;
    };
    textarea.addEventListener('input', () => {
      updateCount();
      setValue(draftKey, textarea.value);
    });
  }
  document.getElementById('answer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (text.length < 2) return toast('Напиши хотя бы пару слов', 'warn');
    const key = todayKey();
    state.answers[key] = {
      ...(state.answers[key] || {}),
      [state.currentRole]: { text, submittedAt: new Date().toISOString() }
    };
    await setValue(draftKey, '');
    await saveState();
    await track('answer_submitted', { questionId: state.questionId, length: text.length });
    toast('Ответ отправлен ❤️');
    demoPartner.scheduleAfterUserAnswer(key);
    render();
  });
  document.getElementById('complete-day')?.addEventListener('click', completeDay);
  document.querySelectorAll('[data-reaction]').forEach((el) =>
    el.addEventListener('click', async () => {
      state.reactions[todayKey()] = el.dataset.reaction;
      await saveState();
      await track('reaction_sent', { reaction: el.dataset.reaction });
      render();
    })
  );
  document.getElementById('enable-push-nudge')?.addEventListener('click', () => {
    pendingSettingsFocus = 'notifications';
    nav('settings');
  });
}

async function maybeHapticReveal() {
  if (!bothAnswered() || screen !== 'today') return;
  const key = todayKey();
  if (state.revealHapticDone?.[key]) {
    revealAnimatedForKey = key;
    return;
  }
  revealAnimatedForKey = null;
  state.revealHapticDone = { ...(state.revealHapticDone || {}), [key]: true };
  await saveState(false);
  await lightImpact();
  requestAnimationFrame(() => {
    document.querySelector('.reveal-section')?.classList.add('reveal-enter');
    revealAnimatedForKey = key;
  });
}

async function completeDay() {
  if (!bothAnswered()) return;
  const q = todayQuestion();
  const key = todayKey();
  const prevCompleted = state.completedDays;
  if (!state.history.some((h) => h.calendarDate === key || h.dayIndex === state.dayIndex)) {
    state.history.push({
      dayIndex: state.dayIndex,
      calendarDate: key,
      date: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date()),
      question: q.text,
      category: q.categoryLabel,
      answers: structuredClone(todayAnswers()),
      reaction: state.reactions[key] || null
    });
    state.completedDays += 1;
    state.streak += 1;
    state.lastCompletedCalendarDate = key;
  }
  await saveState();
  await track('day_completed', { streak: state.streak, completedDays: state.completedDays });
  const mile = streakMilestone(state.streak);
  toast(mile ? `🔥 ${state.streak} дней вместе — веха!` : 'День сохранён. Ваш сад подрос 🌱');
  triggerGardenAnim(prevCompleted, state.completedDays);
  nav('garden');
}

async function resetAllData() {
  demoPartner.cancel();
  await coupleRepository.clearAllData();
  state = structuredClone(initialState);
  await track('app_reset');
  // analytics may be cleared with IDB — re-init quietly
  try {
    await initAnalytics();
  } catch {
    /* ignore */
  }
  screen = 'today';
  toast('Данные сброшены');
  render();
}

async function markReminderConfigured() {
  if (state.reminderConfigured) return;
  state.reminderConfigured = true;
  await saveState(false);
}

async function enableNotifications() {
  await track('notification_permission_viewed');
  const status = await NotificationService.requestPermission();
  if (status === 'granted') {
    await track('notification_enabled');
    if (state.notificationPrefs.daily) {
      await NotificationService.scheduleDailyReminder(state.reminderTime);
    }
    await markReminderConfigured();
    toast('Уведомления включены');
  } else {
    toast('Разрешение не получено', 'warn');
  }
  refreshNotificationNudge();
  if (screen === 'settings') render();
}

async function refreshNotificationNudge() {
  const nudge = document.getElementById('notif-nudge');
  if (!nudge) return;
  const status = await NotificationService.getPermissionStatus();
  // Legacy installs may have toggles on without reminderConfigured.
  if (hasNotificationPrefsEnabled() && !state.reminderConfigured) {
    await markReminderConfigured();
  }
  nudge.hidden = isReminderNudgeDismissed(status);
}

function bindSettings() {
  document.getElementById('save-names')?.addEventListener('click', async () => {
    state.profile.name = document.getElementById('name-setting').value.trim() || 'Ты';
    state.profile.partnerName = document.getElementById('partner-setting').value.trim() || 'Партнёр';
    await saveState();
    render();
    toast('Имена сохранены');
  });
  document.querySelectorAll('[data-pref]').forEach((el) =>
    el.addEventListener('change', async () => {
      state.notificationPrefs[el.dataset.pref] = el.checked;
      await saveState();
      if (el.dataset.pref === 'daily') {
        if (el.checked) {
          await NotificationService.scheduleDailyReminder(state.reminderTime);
        } else await NotificationService.cancelDailyReminder();
      }
      if (el.checked) {
        await markReminderConfigured();
      }
      refreshNotificationNudge();
      if (screen === 'today' || screen === 'settings') render();
    })
  );
  document.getElementById('reminder-time')?.addEventListener('change', async (e) => {
    state.reminderTime = e.target.value;
    await saveState();
    if (state.notificationPrefs.daily) {
      await NotificationService.scheduleDailyReminder(state.reminderTime);
    }
    if (hasNotificationPrefsEnabled()) {
      await markReminderConfigured();
    }
    refreshNotificationNudge();
    if (screen === 'today') render();
  });
  document.getElementById('enable-push')?.addEventListener('click', enableNotifications);
  if (pendingSettingsFocus === 'notifications') {
    pendingSettingsFocus = null;
    requestAnimationFrame(() => {
      document.getElementById('settings-notifications')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  document.getElementById('test-notification')?.addEventListener('click', async () => {
    const status = await NotificationService.requestPermission();
    if (status === 'granted') {
      await NotificationService.sendDebugNotification({
        title: '❤️ Время для вашего вопроса',
        body: 'Тестовое уведомление Ближе.',
        url: '/?screen=today'
      });
      toast('Уведомление отправлено');
    } else toast('Нет разрешения', 'warn');
  });
  document.getElementById('reset-demo')?.addEventListener('click', async () => {
    if (!confirm('Сбросить демо-данные? Все локальные ответы и прогресс будут удалены.')) return;
    if (!confirm('Точно удалить все данные на этом устройстве?')) return;
    await resetAllData();
  });
  document.getElementById('feedback-btn')?.addEventListener('click', sendFeedback);
  document.getElementById('about-privacy')?.addEventListener('click', () => {
    alert(
      'О тестовой версии\n\nЭта тестовая версия хранит данные локально на этом устройстве и не синхронизирует их с другим человеком.\n\nНет аккаунта, рекламных идентификаторов, контактов и геолокации.'
    );
  });

  const versionEl = document.getElementById('version-tap');
  versionEl?.addEventListener('click', async () => {
    versionTapCount += 1;
    clearTimeout(versionTapTimer);
    versionTapTimer = setTimeout(() => {
      versionTapCount = 0;
    }, 2500);
    if (versionTapCount >= 7) {
      versionTapCount = 0;
      state.testLabUnlocked = true;
      await saveState();
      toast('Test Lab открыт');
      render();
    }
  });

  bindTestLab();
}

function bindTestLab() {
  if (!state.testLabUnlocked) return;
  document.getElementById('lab-auto')?.addEventListener('change', async (e) => {
    state.testLab.partnerAutoAnswer = e.target.checked;
    await saveState();
  });
  document.querySelectorAll('.lab-delay').forEach((btn) =>
    btn.addEventListener('click', async () => {
      state.testLab.partnerDelayMs = Number(btn.dataset.delay);
      await saveState();
      toast(`Delay: ${state.testLab.partnerDelayMs}ms`);
      render();
    })
  );
  document.getElementById('lab-trigger-partner')?.addEventListener('click', async () => {
    await demoPartner.triggerPartnerAnswer(todayKey());
    toast('Partner answer triggered');
  });
  document.getElementById('lab-trigger-reveal')?.addEventListener('click', async () => {
    const key = todayKey();
    if (!meAnswered()) {
      state.answers[key] = {
        ...(state.answers[key] || {}),
        [state.currentRole]: { text: 'QA answer', submittedAt: new Date().toISOString() }
      };
    }
    await demoPartner.triggerPartnerAnswer(key);
    nav('today');
  });
  document.getElementById('lab-inc-streak')?.addEventListener('click', async () => {
    state.streak += 1;
    await saveState();
    toast(`Streak ${state.streak}`);
    render();
  });
  document.getElementById('lab-break-streak')?.addEventListener('click', async () => {
    state.streak = 0;
    await saveState();
    toast('Streak broken');
    render();
  });
  document.getElementById('lab-garden')?.addEventListener('click', async () => {
    const prevCompleted = state.completedDays;
    state.completedDays += 1;
    await saveState();
    toast(`Completed days ${state.completedDays}`);
    triggerGardenAnim(prevCompleted, state.completedDays);
    if (screen === 'garden') render();
    else nav('garden');
  });
  document.getElementById('lab-reset-today')?.addEventListener('click', async () => {
    const key = todayKey();
    delete state.answers[key];
    delete state.reactions[key];
    demoPartner.cancel();
    await saveState();
    toast('Today reset');
    nav('today');
  });
  document.getElementById('lab-next-day')?.addEventListener('click', async () => {
    coupleRepository.ensureTodayQuestion(state, { forceNextDay: true });
    demoPartner.cancel();
    await saveState();
    toast(`Тестовый день: ${state.calendarDate}`);
    nav('today');
  });
  document.getElementById('lab-notif')?.addEventListener('click', async () => {
    await NotificationService.sendDebugNotification({
      title: '❤️ Время для вашего вопроса',
      body: 'Test Lab notification',
      url: '/?screen=today'
    });
    toast('Notification scheduled');
  });
  document.getElementById('lab-export')?.addEventListener('click', exportTestData);
  document.getElementById('lab-role-me')?.addEventListener('click', () => setRole('a'));
  document.getElementById('lab-role-partner')?.addEventListener('click', () => setRole('b'));
  document.getElementById('lab-reset-all')?.addEventListener('click', async () => {
    if (!confirm('Reset ALL app data?')) return;
    await resetAllData();
  });

  const jumpGardenTo = async (targetDays, label) => {
    const prev = state.completedDays;
    state.completedDays = targetDays;
    state.streak = Math.max(state.streak, targetDays);
    await saveState();
    toast(`${label}: ${targetDays} дн. · ${gardenFromCompletedDays(targetDays).stage.name}`);
    triggerGardenAnim(prev, state.completedDays);
    nav('garden');
  };

  document.getElementById('lab-scenario-sprout')?.addEventListener('click', () => jumpGardenTo(2, 'Росток'));
  document.getElementById('lab-scenario-young')?.addEventListener('click', () => jumpGardenTo(5, 'Молодое растение'));
  document.getElementById('lab-scenario-flower')?.addEventListener('click', () => jumpGardenTo(9, 'Цветение'));
  document.getElementById('lab-scenario-week')?.addEventListener('click', async () => {
    const prev = state.completedDays;
    state.completedDays += 7;
    state.streak += 7;
    await saveState();
    toast(`+7 дней → ${state.completedDays} · ${gardenFromCompletedDays(state.completedDays).stage.name}`);
    triggerGardenAnim(prev, state.completedDays);
    nav('garden');
  });
  document.getElementById('lab-scenario-full-day')?.addEventListener('click', async () => {
    const key = todayKey();
    const now = new Date().toISOString();
    state.answers[key] = {
      a: { text: 'QA: мой ответ за день', submittedAt: now },
      b: { text: 'QA: ответ партнёра', submittedAt: now }
    };
    state.reactions[key] = '❤️';
    await saveState();
    await completeDay();
    coupleRepository.ensureTodayQuestion(state, { forceNextDay: true });
    demoPartner.cancel();
    await saveState();
    toast(`Полный день → сад · ${state.calendarDate}`);
    nav('garden');
  });
  document.getElementById('lab-scenario-reset-garden')?.addEventListener('click', async () => {
    const prev = state.completedDays;
    state.completedDays = 0;
    state.streak = 0;
    await saveState();
    toast('Сад сброшен к семени');
    triggerGardenAnim(prev, 0);
    nav('garden');
  });
}

async function sendFeedback() {
  const template = `Отзыв о тестовой версии ${config.appName} ${config.versionName}

Что понравилось?

Что было непонятно?

Хотелось ли открыть приложение завтра?

За что вы бы заплатили?

Что раздражало?
`;
  if (config.TEST_FEEDBACK_URL) {
    await openExternalUrl(config.TEST_FEEDBACK_URL);
    return;
  }
  const email = String(config.TEST_FEEDBACK_EMAIL || '').trim();
  if (email) {
    const subject = encodeURIComponent(`Отзыв о ${config.appName} ${config.versionName}`);
    const body = encodeURIComponent(template);
    await openExternalUrl(`mailto:${email}?subject=${subject}&body=${body}`);
    toast('Открываю письмо для отзыва');
    return;
  }
  const result = await shareText({
    title: `Отзыв о ${config.appName}`,
    text: template,
    dialogTitle: 'Поделиться отзывом'
  });
  toast(result.ok ? (result.method === 'clipboard' ? 'Шаблон скопирован' : 'Можно отправить отзыв') : 'Не удалось поделиться', result.ok ? 'default' : 'warn');
}

async function exportTestData() {
  const payload = await buildExportPayload({ state, versionName: config.versionName });
  const text = JSON.stringify(payload, null, 2);
  const result = await shareText({
    title: `Ближе test data ${config.versionName}`,
    text,
    dialogTitle: 'Экспорт тестовых данных'
  });
  toast(result.ok ? 'Экспорт готов' : 'Не удалось экспортировать', result.ok ? 'default' : 'warn');
}

async function setupNativeShell() {
  await configureStatusBar();
  if (runtime.isNative()) {
    try {
      const { App } = await import('@capacitor/app');
      App.addListener('backButton', ({ canGoBack }) => {
        if (screen !== 'today' && state.onboarded) {
          nav('today');
          return;
        }
        if (canGoBack) {
          window.history.back();
        } else {
          App.minimizeApp?.();
        }
      });
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) track('app_open', { resume: true });
      });
    } catch (err) {
      console.warn('App plugin setup skipped', err);
    }
    await NotificationService.handleNotificationTap(({ screen: s }) => nav(s || 'today'));
  }
}

window.addEventListener('error', (event) => {
  if (event.error) showErrorScreen(event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  showErrorScreen(event.reason || new Error('Unhandled rejection'));
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('Ближе установлено 💜');
});

channel?.addEventListener('message', (event) => {
  if (event.data?.type === 'STATE') {
    const role = state.currentRole;
    const unlocked = state.testLabUnlocked;
    state = { ...state, ...event.data.state, currentRole: role, testLabUnlocked: unlocked || event.data.state.testLabUnlocked };
    render();
  }
});

async function boot() {
  document.title = `Ближе ${config.versionName}`;
  await coupleRepository.init();
  await userSession.get();
  await initAnalytics();
  await track('app_open', { platform: runtime.platform() });
  await loadState();
  await setupServiceWorker((url) => {
    const u = new URL(url, location.href);
    nav(u.searchParams.get('screen') || 'today');
  });
  await setupNativeShell();
  render();

  // Resume demo partner timer if waiting
  if (state.onboarded && meAnswered() && !partnerAnswered() && state.testLab?.partnerAutoAnswer !== false) {
    demoPartner.scheduleAfterUserAnswer(todayKey());
  }
}

boot();
