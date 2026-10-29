import { config } from './config.js';
import { getValue, setValue } from './platform/storage.js';
import { runtime, setupServiceWorker } from './platform/runtime.js';
import {
  installOfferMode,
  readInstallDismissed,
  writeInstallDismissed
} from './platform/pwaInstall.js';
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
import { userSession } from './domain/UserSession.js';
import {
  initAnalytics,
  track,
  buildExportPayload,
  getInstallId
} from './domain/analytics.js';
import { decorateQuestion } from './domain/questions.js';
import { migrateState } from './domain/schema.js';
import { emptyDeviceLink, linkFromPairResult, normalizeDeviceLink, bindStateToPair, rememberBoundPairOnLeave } from './domain/link.js';
import { buildLocalBackup, restoreLocalBackup } from './domain/backup.js';
import {
  currentCircleId,
  reactionValue,
  getDayAnswers,
  setDayAnswer,
  getDayReaction,
  setDayReaction
} from './domain/garden/ownership.js';
import { canSync, clearSyncKeyCache, runCoupleSync } from './domain/sync/coupleSync.js';
import { escapeHtml } from './ui/escapeHtml.js';
import { ProductMetadataProvider } from './platform/metadata/productMetadata.js';
import { IncomingShareHandler } from './platform/share/incomingShare.js';
import { WfolioPhotoProvider } from './integrations/wfolio/wfolio.js';
import { renderOurs, renderList, bindOurs, bindList } from './components/lists/ours.js';
import { renderMoments, renderMomentEditor, bindMomentEditor, bindMomentFavorites } from './components/moments/moments.js';
import { renderLife, bindLife } from './components/history/life.js';
import { renderShare, bindShare } from './components/share/shareInbox.js';
import { renderTodayArchive } from './components/today/todayArchive.js';
import { renderPhotoSettings } from './components/settings/photos.js';
import { renderDeviceLink, renderLocalBackup, renderPairRecovery } from './components/settings/link.js';
import { createPair, joinPair, fetchPairStatus, leavePair, pairErrorCopy } from './platform/link/pairClient.js';
import { generatePairIdentity } from './platform/link/pairCrypto.js';
import { renderPlus } from './components/plus/plusView.js';
import { createPlusIntentController, postPlusIntent } from './components/plus/plusIntent.js';
import { renderGardenHome } from './components/garden/gardenView.js';
import { todayPeriodMode, renderPeriodTodayBody, renderOptionalLegacyDaily } from './components/garden/todayPeriod.js';
import { bindPeriodTodayHandlers, bindGardenHandlers } from './components/garden/bindGarden.js';
import { getActivePeriod } from './domain/garden/period.js';
import { derivePeriodProgress } from './domain/garden/progress.js';
import { buildPairRecoveryBundle, restorePairRecoveryBundle } from './domain/garden/recovery.js';
import './styles.css';

const bootParams = new URLSearchParams(location.search);
let state = structuredClone(initialState);
let screen = bootParams.get('screen') || 'today';
let route = {
  listId: bootParams.get('list'),
  momentId: bootParams.get('moment'),
  shareUrl: bootParams.get('url'),
  shareTitle: bootParams.get('title'),
  shareText: bootParams.get('text'),
  periodId: bootParams.get('period'),
  plusSource: ['settings', 'ours', 'other'].includes(bootParams.get('from')) ? bootParams.get('from') : 'other'
};
function readSentPlusIntent() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem('blizhe-plus-intent') || 'null');
    if (parsed?.phase === 'sent' && typeof parsed.requestId === 'string') return parsed;
  } catch {
    /* session storage can be blocked */
  }
  return null;
}
const plusIntent = createPlusIntentController({
  post: postPlusIntent,
  online: () => navigator.onLine,
  initial: readSentPlusIntent()
});
let archiveUi = freshArchiveUi();
const metadataProvider = new ProductMetadataProvider();
const wfolio = new WfolioPhotoProvider({ metadataProvider });
let installPrompt = null;
let versionTapCount = 0;
let versionTapTimer = null;
let gardenAnim = null; // { type: 'grow' | 'stage-up' | 'bloom', stageId?, periodId? }
let lastError = null;
let revealAnimatedForKey = null;
let pendingSettingsFocus = null;
let syncTimer = null;
let syncInFlight = false;
let linkPollTimer = null;

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('blizhe-couple') : null;
const app = document.getElementById('app');
const toastRoot = document.getElementById('toast-root');

function isLivePair() {
  return state.deviceLink?.status === 'linked';
}

function scheduleCoupleSync({ delay = 1800, announce = false } = {}) {
  if (!canSync(state.deviceLink)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncCoupleNow({ announce }).catch(() => {});
  }, delay);
}

async function syncCoupleNow({ announce = false } = {}) {
  if (!canSync(state.deviceLink) || syncInFlight) return;
  syncInFlight = true;
  try {
    const result = await runCoupleSync(state, {
      saveState: async (next) => {
        state = next;
        await coupleRepository.saveState(state);
        channel?.postMessage({ type: 'STATE', state });
      }
    });
    if (result?.state) state = result.state;
    if (announce) toast('Синхронизировано');
    // Garden/today must refresh after sync (mutual answers / completion) without leaving the screen.
    if (screen === 'settings' || screen === 'today' || screen === 'garden') render();
  } catch (error) {
    state.deviceLink = { ...state.deviceLink, syncError: error.code || 'sync_failed' };
    await coupleRepository.saveState(state);
    if (announce) toast(pairErrorCopy(error), 'warn');
    if (screen === 'settings' || screen === 'today' || screen === 'garden') render();
  } finally {
    syncInFlight = false;
  }
}

function ensureLinkPolling() {
  clearInterval(linkPollTimer);
  linkPollTimer = null;
  if (state.deviceLink?.status === 'waiting') {
    linkPollTimer = setInterval(() => {
      refreshDeviceLink(false).catch(() => {});
    }, 5000);
  } else if (canSync(state.deviceLink)) {
    linkPollTimer = setInterval(() => scheduleCoupleSync({ delay: 0 }), 30_000);
  }
}

const demoPartner = new DemoPartnerEngine({
  getState: () => ({ ...state, todayKey: todayKey() }),
  saveAnswerForRole: async (dayKey, role, text, meta = {}) => {
    setDayAnswer(state, dayKey, role, { text, submittedAt: new Date().toISOString(), ...meta });
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
const todayAnswers = () => getDayAnswers(state, todayKey());
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
  if (name === 'home') {
    return `<svg class="ui-icon ui-icon-home" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${gid}" x1="6" y1="6" x2="26" y2="28" gradientUnits="userSpaceOnUse">
        <stop stop-color="#9B7CFF"/><stop offset="1" stop-color="#6E52DF"/>
      </linearGradient></defs>
      <path fill="url(#${gid})" d="M16 5.2 5.5 14.2c-.4.35-.2 1 .35 1H9.2v9.3c0 .7.55 1.25 1.25 1.25h4.1v-6.2h3.1v6.2h4.1c.7 0 1.25-.55 1.25-1.25v-9.3h3.35c.55 0 .75-.65.35-1L16 5.2z"/>
      <path fill="#EDE6FF" opacity=".7" d="M16 8.2 10.2 13.1h1.6v8.4h2.4v-5.4h3.6v5.4h2.4v-8.4h1.6L16 8.2z"/>
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
  const n = Number(state.streak) || 0;
  const lit = n > 0;
  const label = lit ? daysInARowLabel(n) : 'начнём серию';
  return `<div class="streak-chip ${lit ? 'is-lit' : 'is-calm'}" aria-label="Серия: ${n} ${label}">
    <span class="streak-flame" aria-hidden="true">${uiIcon('flame')}</span>
    <span class="streak-meta"><b>${n}</b><small>${label}</small></span>
  </div>`;
}

function freshArchiveUi() {
  return { sheet: null, draft: null, editingItemId: null, prompt: null, momentDraft: null, pendingMedia: [], armDraft: false, query: '', reviewYear: null };
}

function makeCtx() {
  return {
    state,
    role: state.currentRole,
    route,
    ui: archiveUi,
    toast,
    metadataProvider,
    wfolio,
    shareHandler: new IncomingShareHandler({ getLists: () => state.lists || [] }),
    nav,
    rerender: render,
    async commit() {
      await saveState();
      render();
    }
  };
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
  scheduleCoupleSync();
}

async function loadState() {
  state = await coupleRepository.loadState();
  coupleRepository.ensureTodayQuestion(state);
  if (state.deviceLink?.role === 'a' || state.deviceLink?.role === 'b') {
    // Linked pair identity wins over demo role switcher memory.
    state.currentRole = state.deviceLink.role;
    sessionStorage.setItem('blizhe-role', state.currentRole);
  } else {
    const role = sessionStorage.getItem('blizhe-role');
    if (role === 'a' || role === 'b') state.currentRole = role;
  }
}

function setRole(role) {
  state.currentRole = role;
  sessionStorage.setItem('blizhe-role', role);
  render();
}

function nav(to, extra = {}) {
  screen = to;
  archiveUi.sheet = null;
  if (to === 'list') route.listId = extra.listId || null;
  else route.listId = null;
  if (to === 'moment') {
    route.momentId = extra.momentId || 'new';
    if (route.momentId === 'new' && !archiveUi.armDraft) {
      archiveUi.momentDraft = null;
      archiveUi.pendingMedia = [];
    }
    archiveUi.armDraft = false;
  } else route.momentId = null;
  if (to === 'share') {
    if ('shareUrl' in extra) route.shareUrl = extra.shareUrl;
    if ('shareTitle' in extra) route.shareTitle = extra.shareTitle;
    if ('shareText' in extra) route.shareText = extra.shareText;
  }
  if (to !== 'garden') route.periodId = null;
  else if (extra.periodId) route.periodId = extra.periodId;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('screen', to);
  if (to === 'list' && route.listId) url.searchParams.set('list', route.listId);
  if (to === 'moment' && route.momentId) url.searchParams.set('moment', route.momentId);
  if (to === 'garden' && route.periodId) url.searchParams.set('period', route.periodId);
  if (to === 'share') {
    if (route.shareUrl) url.searchParams.set('url', route.shareUrl);
    if (route.shareTitle) url.searchParams.set('title', route.shareTitle);
    if (route.shareText) url.searchParams.set('text', route.shareText);
  }
  if (to === 'packs') {
    if (extra.plusSource === 'settings' || extra.plusSource === 'ours' || extra.plusSource === 'other') {
      route.plusSource = extra.plusSource;
    }
    url.searchParams.set('from', route.plusSource || 'other');
  }
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
  const tab = active === 'list' || active === 'share' ? 'ours' : active === 'moment' ? 'moments' : active;
  return `
    <div class="aurora aurora-one"></div><div class="aurora aurora-two"></div>
    <header class="topbar">
      <button class="brand" data-nav="today" aria-label="На главную" id="brand-logo"><span class="brand-mark">♥</span><span>Ближе</span></button>
      <div class="top-actions">
      ${
        showRoles
          ? `<div class="role-switch">
        <button data-role="a" class="${state.currentRole === 'a' ? 'active' : ''}">${escapeHtml(state.profile.name)}</button>
        <button data-role="b" class="${state.currentRole === 'b' ? 'active' : ''}">${escapeHtml(state.profile.partnerName)}</button>
      </div>`
          : `<div class="top-quiet"><span>для двоих</span></div>`
      }
      <button class="icon-btn ${active === 'settings' ? 'active' : ''}" data-nav="settings" type="button" aria-label="Настройки">⚙</button>
      </div>
    </header>
    <main class="main-content${fitClass}">${content}</main>
    <nav class="tabbar" aria-label="Основная навигация">
      ${tabButton('today', '♡', 'Сегодня', tab)}
      ${tabButton('ours', '✦', 'Наше', tab)}
      ${tabButton('moments', momentTabIcon(), 'Моменты', tab)}
      ${tabButton('garden', '♧', 'Сад', tab)}
      ${tabButton('history', '◷', 'История', tab)}
    </nav>`;
}

function momentTabIcon() {
  return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.7" cy="9" r="1.15" fill="currentColor"/><path d="M6.8 15.2l2.5-2.6a1 1 0 0 1 1.45 0l1.35 1.4 1.15-1.25a1 1 0 0 1 1.5 0L17.2 15.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function tabButton(id, icon, label, active) {
  return `<button data-nav="${id}" class="tab ${active === id ? 'active' : ''}"><span>${icon}</span><small>${label}</small></button>`;
}

function renderOnboarding() {
  track('onboarding_started');
  app.innerHTML = `
  <div class="onboarding-page">
    <div class="onboarding-visual" aria-hidden="true">
      <span class="glow glow-a"></span>
      <span class="glow glow-b"></span>
      <span class="glow glow-c"></span>
      <span class="spark spark-1"></span>
      <span class="spark spark-2"></span>
      <span class="spark spark-3"></span>
      <span class="spark spark-4"></span>
      <span class="spark spark-5"></span>
      <div class="orbit orbit-a">💜</div>
      <div class="orbit orbit-b">✨</div>
      <div class="orbit orbit-c">🌱</div>
      <div class="orbit orbit-d">💬</div>
      <div class="orbit orbit-e">⭐</div>
      <div class="orbit orbit-f">🤍</div>
      <div class="hero-heart">♥</div>
    </div>
    <section class="onboarding-card">
      <div class="eyebrow">Для двоих</div>
      <h1>Ближе каждый день.</h1>
      <p class="lead">Один вопрос — и два ваших ответа. Маленькая привычка, чтобы не терять друг друга в суете.</p>
      <div class="feature-row"><span>🔒</span><div><b>Только ваши</b><small>Ответы живут на ваших телефонах.</small></div></div>
      <div class="feature-row"><span>💬</span><div><b>Без ленты</b><small>Один разговор в день — и можно жить дальше.</small></div></div>
      <div class="feature-row"><span>🌱</span><div><b>Общий сад</b><small>Когда отвечаете вдвоём, растение растёт.</small></div></div>
      <form id="start-form" class="onboarding-form">
        <label>Как тебя зовут?<input name="name" maxlength="24" value="" placeholder="Твоё имя" required></label>
        <label>А партнёра?<input name="partnerName" maxlength="24" value="" placeholder="Имя партнёра" required></label>
        <button class="primary large" type="submit">Начать <span>→</span></button>
      </form>
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
    toast('Рады вас видеть 💜');
    render();
  });
}

function legacyDailyBody() {
  const q = todayQuestion();
  const answers = todayAnswers();
  const dayDone = state.lastCompletedCalendarDate === todayKey();

  if (dayDone) {
    return `
      <section class="waiting-card glass-card">
        <div class="pill">На сегодня хватит</div>
        <h2>Этот разговор уже сохранён</h2>
        <p>Он для вас двоих — сад растёт от темы периода. Загляните туда, если хочется.</p>
        <div class="button-row wrap" style="justify-content:center">
          <button class="primary" data-nav="garden">В сад</button>
        </div>
      </section>`;
  }
  if (!meAnswered()) {
    return `
      <section class="question-card glass-card">
        <div class="question-meta"><span class="pill">${escapeHtml(q.categoryLabel)}</span><span>По желанию</span></div>
        <h2>${escapeHtml(q.text)}</h2>
        <p class="question-note">Это просто ещё один разговор — сад от него не растёт.</p>
        <form id="answer-form">
          <textarea id="answer-text" maxlength="700" rows="4" placeholder="Напиши, как есть…" enterkeyhint="done"></textarea>
          <div class="textarea-footer"><span id="char-count">0 / 700</span><span>Черновик сохраняется сам</span></div>
          <button class="primary large full sticky-cta" type="submit">Отправить <span>♥</span></button>
        </form>
      </section>`;
  }
  if (!partnerAnswered()) {
    return `
      <section class="waiting-card glass-card">
        <div class="pulse-heart">♥</div>
        <h2>Ждём ответ ${escapeHtml(state.profile.partnerName)}</h2>
        <p>Можно пока заняться своими делами — мы напомним, когда ответ придёт.</p>
      </section>`;
  }
  const key = todayKey();
  return `
    <section class="reveal-section ${revealAnimatedForKey === key ? '' : 'reveal-enter'}">
      <div class="reveal-heading"><div class="confetti">✦</div><div><div class="eyebrow">Оба ответили</div><h2>${escapeHtml(q.text)}</h2></div></div>
      <div class="answers-grid">
        ${answerCard(state.profile.name, answers.a?.text, 'violet')}
        ${answerCard(state.profile.partnerName, answers.b?.text, 'rose')}
      </div>
      <div class="reaction-row">
        <span class="reaction-label">Реакция:</span>
        <div class="reaction-actions" role="group" aria-label="Реакции">
        ${['❤️', '🥹', '😂', '🤗']
          .map(
            (r) =>
              `<button type="button" class="reaction ${reactionValue(getDayReaction(state, key)) === r ? 'active' : ''}" data-reaction="${r}" aria-label="Реакция ${r}"><span class="reaction-emoji">${r}</span></button>`
          )
          .join('')}
        </div>
      </div>
      <div class="completion-card">
        <div><span class="completion-icon">📝</span><div><b>В историю</b><small>Просто сохранить разговор — без роста сада.</small></div></div>
        <button class="primary" id="complete-day">Сохранить →</button>
      </div>
    </section>`;
}

function todayView() {
  const periodCtx = todayPeriodMode(state);
  let body = '';

  if (periodCtx.mode !== 'none') {
    if (periodCtx.mode === 'period-answer') {
      track('period_question_viewed', { periodId: periodCtx.period.id, questionId: periodCtx.question.id });
    }
    body = renderPeriodTodayBody(state, periodCtx);
    if (periodCtx.mode === 'period-waiting-schedule' || periodCtx.mode === 'period-reveal') {
      body += renderOptionalLegacyDaily(state, legacyDailyBody());
    }
  } else if (!getActivePeriod(state)) {
    body = `
      <section class="waiting-card glass-card">
        <div class="pulse-heart">🌱</div>
        <div class="pill">Сад</div>
        <h2>Выберите тему вместе</h2>
        <p>В саду — растения на выбор. Пока темы нет, можно просто ответить на вопрос дня.</p>
        <div class="button-row wrap" style="justify-content:center">
          <button class="primary" data-nav="garden">К темам</button>
        </div>
      </section>
      ${renderOptionalLegacyDaily(state, legacyDailyBody())}`;
  } else {
    body = renderPeriodTodayBody(state, periodCtx) + renderOptionalLegacyDaily(state, legacyDailyBody());
  }

  const syncBanner = state.deviceLink?.syncError
    ? `<div class="sync-banner warn" role="status">${escapeHtml(pairErrorCopy({ code: state.deviceLink.syncError }))}</div>`
    : !navigator.onLine
      ? `<div class="sync-banner" role="status">Сейчас без сети — ответы уже на телефоне и уйдут, как только появится связь.</div>`
      : '';

  return shell(`
    <section class="dashboard-head">
      <div class="dashboard-copy"><div class="eyebrow">Сегодня · ${escapeHtml(roleLabel())}</div><h1>${escapeHtml(todayGreeting())}</h1><p class="today-lead">Вопрос темы растит сад. Остальное — если хочется поговорить ещё.</p></div>
      ${streakBubble()}
    </section>
    ${notificationNudge()}
    ${installNudge()}
    ${syncBanner}
    ${body}
    ${renderTodayArchive(state)}
  `, 'today');
}

function todayGreeting() {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  return `${hello} ❤️`;
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
        <b>Напоминание о вопросе</b>
        <small>Тихое уведомление в удобное время.</small>
      </div>
    </div>
    <button class="ghost" id="enable-push-nudge" type="button">Настроить</button>
  </section>`;
}

function currentInstallMode({ ignoreDismiss = false } = {}) {
  return installOfferMode({
    deferredPrompt: installPrompt,
    dismissed: readInstallDismissed(),
    isNative: runtime.isNative(),
    ignoreDismiss
  });
}

function installNudge() {
  // Start hidden; refreshInstallOffer reveals when Chrome deferred the prompt or iOS Safari can Add to Home Screen.
  return `<section class="notification-nudge install-nudge" id="install-nudge" hidden>
    <div class="nudge-main">
      <span class="nudge-icon" aria-hidden="true">${uiIcon('home')}</span>
      <div class="nudge-copy">
        <b id="install-nudge-title">На домашний экран</b>
        <small id="install-nudge-text">Откроется как приложение — без строки браузера.</small>
      </div>
    </div>
    <div class="nudge-actions">
      <button class="ghost" id="install-nudge-dismiss" type="button">Позже</button>
      <button class="ghost install-nudge-cta" id="install-nudge-cta" type="button">Установить</button>
    </div>
  </section>`;
}

function renderInstallSettings() {
  const mode = currentInstallMode({ ignoreDismiss: true });
  if (!mode) return '';
  if (mode === 'ios') {
    return `<section class="settings-card" id="settings-install">
      <h2>На домашний экран</h2>
      <p>В Safari: нажмите «Поделиться», затем «На экран „Домой“». Так Ближе откроется как обычное приложение.</p>
      <ol class="install-steps">
        <li>Кнопка «Поделиться» внизу Safari</li>
        <li>«На экран „Домой“»</li>
        <li>Подтвердите «Добавить»</li>
      </ol>
    </section>`;
  }
  return `<section class="settings-card" id="settings-install">
    <h2>На домашний экран</h2>
    <p>Поставьте Ближе как приложение — быстрее открывается и без строки браузера.</p>
    <div class="button-row wrap">
      <button class="primary" id="settings-install-btn" type="button">Установить</button>
    </div>
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
  return shell(
    renderGardenHome(state, { gardenAnim, selectedPeriodId: route.periodId || null }),
    'garden'
  );
}

function triggerPeriodAnim(period, prevStageId, result) {
  if (!period) return;
  const progress = derivePeriodProgress(period);
  gardenAnim = {
    type: result?.bloomEvent ? 'bloom' : progress.stage.id !== prevStageId ? 'stage-up' : 'grow',
    periodId: period.id,
    stageId: progress.stage.id
  };
  setTimeout(() => {
    if (gardenAnim?.periodId === period.id) gardenAnim = null;
  }, result?.bloomEvent ? 1800 : 1200);
}

function packsView() {
  return shell(renderPlus(plusIntent.snapshot()), 'packs');
}

function settingsView() {
  const isNative = runtime.isNative();
  return shell(
    `
    <section class="page-head"><div><div class="eyebrow">Вы и напоминания</div><h1>Настройки</h1><p>Имена, уведомления и пара мелочей о приложении.</p></div></section>

    <section class="settings-card">
      <h2>Пара</h2>
      <label class="setting-field">Твоё имя<input id="name-setting" value="${escapeHtml(state.profile.name)}" maxlength="24"></label>
      <label class="setting-field">Имя партнёра<input id="partner-setting" value="${escapeHtml(state.profile.partnerName)}" maxlength="24"></label>
      <button class="secondary" id="save-names">Сохранить</button>
    </section>

    ${renderDeviceLink(state)}

    <section class="settings-card" id="settings-notifications">
      <h2>Уведомления</h2>
      ${prefToggle('daily', 'Вопрос дня', 'Тихое напоминание раз в день')}
      ${prefToggle('partner', 'Партнёр ответил', 'Когда можно заглянуть дальше')}
      ${prefToggle('reveal', 'Оба ответили', 'Когда можно читать друг друга')}
      ${prefToggle('streak', 'Серия под риском', 'Необязательно вечером')}
      <label class="setting-field inline">Время<input id="reminder-time" type="time" value="${state.reminderTime}"></label>
      <div class="button-row wrap" style="margin-top:12px">
        <button class="primary" id="enable-push">Разрешить уведомления</button>
        ${state.testLabUnlocked ? `<button class="secondary" id="test-notification">Тестовое уведомление</button>` : ''}
      </div>
      <p class="microcopy">${isNative ? 'Напоминания приходят с телефона.' : 'В браузере это уведомления страницы; фоновый push — отдельная история.'}</p>
    </section>

    ${renderPhotoSettings(state)}
    ${renderLocalBackup()}
    ${renderPairRecovery(state)}
    ${renderInstallSettings()}

    <section class="settings-card plus-entry">
      <h2>Ближе Plus</h2>
      <p>Новые темы, сад и воспоминания — одна подписка на двоих. Запуск ещё готовим, оплату можно только запросить.</p>
      <button class="plus-entry-link" type="button" data-nav="packs" data-plus-source="settings">Ближе Plus</button>
    </section>

    <section class="settings-card">
      <h2>О приложении</h2>
      <p>Ответы, сад и история живут на ваших телефонах. Сервер видит только связь устройств — не тексты. Между телефонами всё шифруется.</p>
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
    const ctx = makeCtx();
    const views = {
      today: todayView,
      garden: gardenView,
      history: () => shell(renderLife(ctx), 'history'),
      ours: () => shell(renderOurs(ctx), 'ours'),
      list: () => shell(renderList(ctx), 'list'),
      moments: () => shell(renderMoments(ctx), 'moments'),
      moment: () => shell(renderMomentEditor(ctx), 'moment'),
      share: () => shell(renderShare(ctx), 'share'),
      packs: packsView,
      settings: settingsView
    };
    app.innerHTML = (views[screen] || todayView)();
    bindCommon();
    bindScreen();
    refreshNotificationNudge();
    refreshInstallOffer();
    maybeHapticReveal();
  } catch (err) {
    console.error(err);
    showErrorScreen(err);
  }
}

function bindCommon() {
  document.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => {
    const extra = {};
    if (el.dataset.list) extra.listId = el.dataset.list;
    if (el.dataset.moment) extra.momentId = el.dataset.moment;
    if (el.dataset.plusSource) extra.plusSource = el.dataset.plusSource;
    nav(el.dataset.nav, extra);
  }));
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
  const ctx = makeCtx();
  if (screen === 'today') bindToday();
  if (screen === 'garden') {
    bindGardenHandlers({
      getState: () => state,
      route,
      saveState,
      scheduleCoupleSync,
      toast,
      render,
      nav
    });
  }
  if (screen === 'packs') bindPlus();
  if (screen === 'settings') bindSettings();
  if (screen === 'ours') bindOurs(ctx);
  if (screen === 'list') bindList(ctx);
  if (screen === 'moments') bindMomentFavorites(ctx);
  if (screen === 'moment') bindMomentEditor(ctx);
  if (screen === 'history') bindLife(ctx);
  if (screen === 'share') bindShare(ctx);
}

function bindPlus() {
  document.querySelectorAll('[data-plus-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      plusIntent.selectPlan(button.dataset.plusPlan);
      render();
    });
  });
  document.getElementById('plus-thanks-ok')?.addEventListener('click', () => {
    plusIntent.dismissNotice();
    render();
  });
  document.getElementById('plus-cta')?.addEventListener('click', async () => {
    const started = plusIntent.startSubmit();
    render();
    if (started !== 'started') return;
    const result = await plusIntent.finishSubmit(route.plusSource || 'other');
    if (result.phase === 'sent') {
      try {
        sessionStorage.setItem('blizhe-plus-intent', JSON.stringify({
          phase: 'sent',
          plan: result.plan,
          requestId: result.requestId
        }));
      } catch {
        /* the server already dedupes this request id */
      }
    }
    if (screen === 'packs') {
      render();
      document.getElementById('plus-thanks')?.scrollIntoView({ block: 'center' });
    }
  });
}

function bindToday() {
  bindPeriodTodayHandlers({
    getState: () => state,
    saveState,
    scheduleCoupleSync,
    track,
    toast,
    render,
    triggerPeriodAnim
  });
  const textarea = document.getElementById('answer-text');
  const draftKey = `draft-${currentCircleId(state) || 'solo'}-${state.currentRole}-${todayKey()}`;
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
    setDayAnswer(state, key, state.currentRole, { text, submittedAt: new Date().toISOString() });
    await setValue(draftKey, '');
    await saveState();
    await track('answer_submitted', { questionId: state.questionId, length: text.length });
    toast('Отправлено ❤️');
    if (!isLivePair()) demoPartner.scheduleAfterUserAnswer(key);
    render();
  });
  document.getElementById('complete-day')?.addEventListener('click', completeDay);
  document.querySelectorAll('[data-reaction]').forEach((el) =>
    el.addEventListener('click', async () => {
      setDayReaction(state, todayKey(), {
        value: el.dataset.reaction,
        updatedAt: new Date().toISOString()
      });
      await saveState();
      await track('reaction_sent', { reaction: el.dataset.reaction });
      render();
    })
  );
  document.getElementById('enable-push-nudge')?.addEventListener('click', () => {
    pendingSettingsFocus = 'notifications';
    nav('settings');
  });
  bindInstallOfferControls();
}

async function maybeHapticReveal() {
  if (!bothAnswered() || screen !== 'today') return;
  const key = todayKey();
  const hapticKey = `${currentCircleId(state) || 'solo'}:${key}`;
  if (state.revealHapticDone?.[hapticKey]) {
    revealAnimatedForKey = key;
    return;
  }
  revealAnimatedForKey = null;
  state.revealHapticDone = { ...(state.revealHapticDone || {}), [hapticKey]: true };
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
  const circle = currentCircleId(state) || state.circleId || null;
  const prevCompleted = state.completedDays;
  const alreadyDone = (state.history || []).some(
    (h) => h.circleId === circle && (h.calendarDate === key || h.dayIndex === state.dayIndex)
  );
  if (!alreadyDone) {
    state.history.push({
      dayIndex: state.dayIndex,
      calendarDate: key,
      circleId: circle,
      date: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date()),
      question: q.text,
      category: q.categoryLabel,
      answers: structuredClone(todayAnswers()),
      reaction: getDayReaction(state, key) || null
    });
    state.completedDays += 1;
    state.streak += 1;
    state.lastCompletedCalendarDate = key;
  }
  await saveState();
  await track('day_completed', { streak: state.streak, completedDays: state.completedDays });
  const mile = streakMilestone(state.streak);
  toast(mile ? `🔥 ${state.streak} дней вместе — это веха!` : 'Сохранили. Сад чуть подрос 🌱');
  triggerGardenAnim(prevCompleted, state.completedDays);
  nav('garden');
}

async function resetAllData() {
  demoPartner.cancel();
  await coupleRepository.clearAllData();
  state = migrateState(structuredClone(initialState));
  archiveUi = freshArchiveUi();
  route = { listId: null, momentId: null, shareUrl: null, shareTitle: null, shareText: null };
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

function refreshInstallOffer() {
  const nudge = document.getElementById('install-nudge');
  const mode = currentInstallMode();
  if (nudge) {
    const title = document.getElementById('install-nudge-title');
    const text = document.getElementById('install-nudge-text');
    const cta = document.getElementById('install-nudge-cta');
    if (mode === 'prompt') {
      if (title) title.textContent = 'На домашний экран';
      if (text) text.textContent = 'Откроется как приложение — без строки браузера.';
      if (cta) cta.textContent = 'Установить';
      nudge.hidden = false;
    } else if (mode === 'ios') {
      if (title) title.textContent = 'На домашний экран';
      if (text) text.textContent = 'В Safari: Поделиться → На экран «Домой».';
      if (cta) cta.textContent = 'Понятно';
      nudge.hidden = false;
    } else {
      nudge.hidden = true;
    }
  }
}

async function promptPwaInstall() {
  if (!installPrompt) {
    toast('Установка сейчас недоступна', 'warn');
    return;
  }
  const deferred = installPrompt;
  installPrompt = null;
  try {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    await track('pwa_install_prompt', { outcome: choice?.outcome || 'unknown' });
    if (choice?.outcome === 'accepted') {
      writeInstallDismissed();
    } else {
      refreshInstallOffer();
      if (screen === 'settings') render();
    }
  } catch (err) {
    console.warn('PWA install prompt failed', err);
    toast('Не удалось открыть установку', 'warn');
    refreshInstallOffer();
  }
}

function dismissInstallOffer() {
  writeInstallDismissed();
  refreshInstallOffer();
  if (screen === 'settings') render();
}

function bindInstallOfferControls() {
  document.getElementById('install-nudge-cta')?.addEventListener('click', async () => {
    const mode = currentInstallMode();
    if (mode === 'ios') {
      dismissInstallOffer();
      return;
    }
    await promptPwaInstall();
  });
  document.getElementById('install-nudge-dismiss')?.addEventListener('click', () => {
    dismissInstallOffer();
  });
  document.getElementById('settings-install-btn')?.addEventListener('click', () => {
    promptPwaInstall();
  });
}

async function refreshDeviceLink(announce) {
  const token = state.deviceLink?.deviceToken;
  if (!token) return;
  try {
    const status = await fetchPairStatus(token);
    const previous = state.deviceLink.status;
    const previousPairId = state.deviceLink.pairId || state.lastBoundPairId || null;
    state.deviceLink = normalizeDeviceLink({
      ...state.deviceLink,
      pairId: status.pairId,
      role: status.role,
      status: status.status,
      linkedAt: status.linkedAt || state.deviceLink.linkedAt,
      inviteCode: status.status === 'linked' ? null : state.deviceLink.inviteCode,
      inviteExpiresAt: status.status === 'linked' ? null : state.deviceLink.inviteExpiresAt,
      peerPublicKey: status.peerPublicKey || state.deviceLink.peerPublicKey,
      syncRevision: status.syncRevision ?? state.deviceLink.syncRevision
    });
    if (status.pairId) {
      bindStateToPair(state, status.pairId, { previousPairId });
    }
    if (state.deviceLink.role === 'a' || state.deviceLink.role === 'b') {
      state.currentRole = state.deviceLink.role;
    }
    if (state.deviceLink.status !== previous) {
      await saveState(false);
      ensureLinkPolling();
      if (canSync(state.deviceLink)) await syncCoupleNow({ announce: true });
      else if (screen === 'settings') render();
      return;
    }
    if (announce) toast(status.status === 'linked' ? 'Второй телефон уже подключился' : 'Пока ждём второй телефон');
  } catch (error) {
    if (error.code === 'unauthorized') {
      clearSyncKeyCache();
      rememberBoundPairOnLeave(state);
      state.deviceLink = emptyDeviceLink();
      await saveState(false);
      ensureLinkPolling();
      if (screen === 'settings') render();
      return;
    }
    if (announce) toast(pairErrorCopy(error), 'warn');
  }
}

function bindSettings() {
  bindInstallOfferControls();
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
  document.querySelectorAll('input[name="photo-storage"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      coupleRepository.setPhotoStorage(state, input.value);
      await saveState();
      toast(input.value === 'links' ? 'Сохраняем только ссылки' : input.value === 'original' ? 'Будем хранить оригиналы' : 'Будем хранить превью');
    });
  });
  document.getElementById('clear-photo-cache')?.addEventListener('click', async () => {
    if (!confirm('Очистить локальный кэш фотографий? Сами моменты останутся.')) return;
    const result = coupleRepository.clearLocalPhotoCache(state);
    await saveState();
    render();
    toast(result.freed ? 'Локальные фото очищены' : 'Кэш уже пуст');
  });
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
  document.getElementById('pair-create')?.addEventListener('click', async () => {
    try {
      const identity = await generatePairIdentity();
      const previousPairId = state.deviceLink?.pairId || state.lastBoundPairId || null;
      const created = await createPair(identity.publicKey);
      state.deviceLink = linkFromPairResult(created, identity);
      if (state.deviceLink.role === 'a' || state.deviceLink.role === 'b') {
        state.currentRole = state.deviceLink.role;
      }
      bindStateToPair(state, created.pairId, { previousPairId });
      await saveState(false);
      ensureLinkPolling();
      render();
    } catch (error) {
      toast(pairErrorCopy(error), 'warn');
    }
  });
  document.getElementById('pair-join')?.addEventListener('click', async () => {
    const code = document.getElementById('pair-code')?.value || '';
    try {
      const identity = await generatePairIdentity();
      const previousPairId = state.deviceLink?.pairId || state.lastBoundPairId || null;
      const joined = await joinPair(code, identity.publicKey);
      state.deviceLink = linkFromPairResult(joined, identity);
      if (state.deviceLink.role === 'a' || state.deviceLink.role === 'b') {
        state.currentRole = state.deviceLink.role;
      }
      bindStateToPair(state, joined.pairId, { previousPairId });
      await saveState(false);
      ensureLinkPolling();
      toast('Телефоны связаны');
      await syncCoupleNow({ announce: true });
      render();
    } catch (error) {
      toast(pairErrorCopy(error), 'warn');
    }
  });
  document.getElementById('pair-refresh')?.addEventListener('click', () => refreshDeviceLink(true));
  document.getElementById('pair-sync-now')?.addEventListener('click', () => syncCoupleNow({ announce: true }));
  document.getElementById('pair-leave')?.addEventListener('click', async () => {
    if (!confirm('Отвязать этот телефон? Ответы на нём останутся, общая синхронизация остановится.')) return;
    try {
      if (state.deviceLink?.deviceToken) await leavePair(state.deviceLink.deviceToken);
      clearSyncKeyCache();
      rememberBoundPairOnLeave(state);
      state.deviceLink = emptyDeviceLink();
      await saveState(false);
      ensureLinkPolling();
      render();
    } catch (error) {
      toast(pairErrorCopy(error), 'warn');
    }
  });
  document.getElementById('backup-download')?.addEventListener('click', () => {
    const payload = buildLocalBackup(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `blizhe-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Копия сохранена файлом');
  });
  document.getElementById('backup-restore')?.addEventListener('click', () => {
    document.getElementById('backup-file')?.click();
  });
  document.getElementById('backup-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!confirm('Вернуть ответы из файла? Текущая история на этом телефоне будет заменена копией. Связь не восстанавливается из обычной копии.')) return;
    try {
      const payload = JSON.parse(await file.text());
      state = restoreLocalBackup(state, payload);
      await saveState();
      toast('Копия возвращена');
      render();
    } catch {
      toast('Файл не похож на копию Ближе', 'warn');
    }
  });
  document.getElementById('recovery-download')?.addEventListener('click', async () => {
    const passphrase = document.getElementById('recovery-passphrase')?.value || '';
    try {
      const bundle = await buildPairRecoveryBundle(state, passphrase);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `blizhe-pair-recovery-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast('Recovery-файл сохранён');
    } catch (error) {
      if (error.code === 'passphrase_too_short') toast('Пароль слишком короткий (мин. 8)', 'warn');
      else if (error.code === 'recovery_unavailable') toast('Сначала создайте связь телефонов', 'warn');
      else toast('Не удалось создать recovery', 'warn');
    }
  });
  document.getElementById('recovery-restore')?.addEventListener('click', () => {
    document.getElementById('recovery-file')?.click();
  });
  document.getElementById('recovery-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const passphrase = document.getElementById('recovery-passphrase')?.value || '';
    if (!confirm('Восстановить ключи связи из файла? Контент не меняется — только deviceLink.')) return;
    try {
      const bundle = JSON.parse(await file.text());
      state = await restorePairRecoveryBundle(state, bundle, passphrase);
      clearSyncKeyCache();
      await saveState(false);
      ensureLinkPolling();
      toast('Связь восстановлена из recovery');
      await syncCoupleNow({ announce: true });
      render();
    } catch (error) {
      if (error.code === 'recovery_decrypt_failed') toast('Неверный пароль или повреждённый файл', 'warn');
      else toast('Не удалось восстановить связь', 'warn');
    }
  });
  refreshDeviceLink(false);
  document.getElementById('reset-demo')?.addEventListener('click', async () => {
    if (!confirm('Сбросить демо-данные? Все локальные ответы и прогресс будут удалены.')) return;
    if (!confirm('Точно удалить все данные на этом устройстве?')) return;
    await resetAllData();
  });
  document.getElementById('feedback-btn')?.addEventListener('click', sendFeedback);
  document.getElementById('about-privacy')?.addEventListener('click', () => {
    alert(
      'О тестовой версии\n\nОтветы, моменты и сад хранятся на этом телефоне.\n\nСервер связи, если он включён, хранит только код пары и метки двух устройств. Тексты туда не отправляются.\n\nНет рекламных идентификаторов, контактов и геолокации.'
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
      setDayAnswer(state, key, state.currentRole, {
        text: 'QA answer',
        submittedAt: new Date().toISOString()
      });
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
    const c = currentCircleId(state) || state.circleId;
    if (c && state.answers?.[c]) delete state.answers[c][key];
    if (c && state.reactions?.[c]) delete state.reactions[c][key];
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
    setDayAnswer(state, key, 'a', { text: 'QA: мой ответ за день', submittedAt: now });
    setDayAnswer(state, key, 'b', { text: 'QA: ответ партнёра', submittedAt: now });
    setDayReaction(state, key, { value: '❤️', updatedAt: now });
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
      App.addListener('appUrlOpen', ({ url }) => {
        try {
          const opened = new URL(url);
          const shared = opened.searchParams.get('url') || opened.searchParams.get('text');
          if (opened.searchParams.get('screen') === 'share' || shared) {
            nav('share', {
              shareUrl: opened.searchParams.get('url') || '',
              shareTitle: opened.searchParams.get('title') || '',
              shareText: opened.searchParams.get('text') || ''
            });
          }
        } catch {
          // ignore malformed native urls
        }
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
  refreshInstallOffer();
  if (screen === 'settings' && state?.onboarded) render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  writeInstallDismissed();
  refreshInstallOffer();
  toast('Ближе установлено 💜');
  track('pwa_installed');
  if (screen === 'settings' && state?.onboarded) render();
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
  ensureLinkPolling();
  if (canSync(state.deviceLink)) scheduleCoupleSync({ delay: 800 });
  render();

  // E2E / lab hook: sync without leaving the current screen.
  if (typeof window !== 'undefined') {
    window.__nearerSyncNow = () => syncCoupleNow({ announce: false });
  }

  // Demo partner only for single-phone hypothesis — never when a real pair is linked.
  if (
    !isLivePair() &&
    state.onboarded &&
    meAnswered() &&
    !partnerAnswered() &&
    state.testLab?.partnerAutoAnswer !== false
  ) {
    demoPartner.scheduleAfterUserAnswer(todayKey());
  }
}

boot();
