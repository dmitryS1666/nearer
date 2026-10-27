import { createId } from '../ids.js';
import { newEntity, touch, touchStatus } from '../syncMeta.js';
import { getThemeById, snapshotTheme, GARDEN_CONTENT_VERSION, REQUIRED_QUESTION_COUNT } from './themes.js';
import {
  calendarDateInTimeZone,
  countMutualAnswers,
  currentPeriodQuestion,
  derivePeriodProgress,
  detectTimeZone,
  hasNonEmptyAnswer,
  isQuestionUnlocked
} from './progress.js';
import { currentCircleId } from './ownership.js';

function circleOf(state) {
  return currentCircleId(state);
}

function inCurrentCircle(period, state) {
  const c = circleOf(state);
  if (!c) return !period?.circleId;
  return period?.circleId === c;
}

export function getActivePeriod(state) {
  const c = circleOf(state);
  return (
    (state.periods || []).find((p) => p.status === 'active' && (!c || p.circleId === c)) || null
  );
}

export function getPeriodById(state, periodId) {
  const period = (state.periods || []).find((p) => p.id === periodId) || null;
  if (!period) return null;
  if (!inCurrentCircle(period, state)) return null;
  return period;
}

export function listPeriods(state) {
  const c = circleOf(state);
  return (state.periods || []).filter((p) => !c || p.circleId === c);
}

export function listCompletedPeriods(state) {
  return listPeriods(state)
    .filter((p) => p.status === 'completed')
    .sort((a, b) => String(b.completedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.updatedAt || '')));
}

export function listPausedPeriods(state) {
  return listPeriods(state)
    .filter((p) => p.status === 'paused')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function ensurePeriodsArray(state) {
  if (!Array.isArray(state.periods)) state.periods = [];
  return state;
}

export function stampCompare(a, b) {
  const ta = Date.parse(a?.updatedAt || a?.createdAt || 0) || 0;
  const tb = Date.parse(b?.updatedAt || b?.createdAt || 0) || 0;
  if (ta !== tb) return ta - tb;
  const va = Number(a?.version) || 0;
  const vb = Number(b?.version) || 0;
  if (va !== vb) return va - vb;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function statusStampCompare(a, b) {
  const ta = Date.parse(a?.statusUpdatedAt || 0) || 0;
  const tb = Date.parse(b?.statusUpdatedAt || 0) || 0;
  if (ta !== tb) return ta - tb;
  const va = Number(a?.statusVersion) || 0;
  const vb = Number(b?.statusVersion) || 0;
  if (va !== vb) return va - vb;
  // Deterministic, order-independent tie-break when status ops collide.
  const sa = String(a?.status || '');
  const sb = String(b?.status || '');
  if (sa !== sb) return sa.localeCompare(sb);
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * After any merge: at most one active period **in the current circle**.
 * Winner = earliest (createdAt, id). Others paused with conflictNote.
 * Idempotent: already-paused dual losers are not re-touched every sync.
 */
export function normalizeActivePeriods(state, { now = new Date().toISOString(), circleId = null } = {}) {
  ensurePeriodsArray(state);
  const c = circleId || circleOf(state);
  const actives = state.periods.filter(
    (p) => p.status === 'active' && (!c || p.circleId === c || !p.circleId)
  );
  if (actives.length <= 1) return { state, pausedIds: [] };
  const ranked = [...actives].sort((a, b) => {
    const ca = Date.parse(a.createdAt || 0) || 0;
    const cb = Date.parse(b.createdAt || 0) || 0;
    if (ca !== cb) return ca - cb;
    return String(a.id).localeCompare(String(b.id));
  });
  const keep = ranked[0];
  const pausedIds = [];
  for (const p of ranked.slice(1)) {
    p.status = 'paused';
    p.pausedAt = p.pausedAt || now;
    p.conflictNote = 'dual_active_paused';
    touchStatus(p, now);
    pausedIds.push(p.id);
  }
  // Subsequent syncs see actives.length <= 1 and do not re-touch losers.
  keep.status = 'active';
  return { state, pausedIds, keptId: keep.id };
}

export function startPeriod(state, themeId, {
  now = new Date(),
  idFactory = createId,
  timeZone = detectTimeZone(),
  contentVersion = GARDEN_CONTENT_VERSION
} = {}) {
  ensurePeriodsArray(state);
  if (getActivePeriod(state)) {
    const error = new Error('active_period_exists');
    error.code = 'active_period_exists';
    throw error;
  }
  const theme = getThemeById(themeId);
  if (!theme) {
    const error = new Error('theme_not_found');
    error.code = 'theme_not_found';
    throw error;
  }
  const iso = typeof now === 'string' ? now : now.toISOString();
  const dateObj = typeof now === 'string' ? new Date(now) : now;
  const circleId = circleOf(state) || state.circleId || null;
  const period = newEntity(
    {
      id: idFactory(),
      circleId,
      themeId: theme.id,
      status: 'active',
      startDate: calendarDateInTimeZone(dateObj, timeZone),
      timeZone,
      completedAt: null,
      pausedAt: null,
      contentSnapshot: snapshotTheme(theme, contentVersion),
      answers: {},
      challenge: {},
      conflictNote: null,
      statusUpdatedAt: iso,
      statusVersion: 1
    },
    iso
  );
  state.periods.push(period);
  normalizeActivePeriods(state, { now: iso });
  return { state, period };
}

export function pausePeriod(state, periodId, { now = new Date().toISOString() } = {}) {
  ensurePeriodsArray(state);
  const period = getPeriodById(state, periodId);
  if (!period) {
    const error = new Error('period_not_found');
    error.code = 'period_not_found';
    throw error;
  }
  if (period.status === 'completed') {
    const error = new Error('period_completed');
    error.code = 'period_completed';
    throw error;
  }
  if (period.status === 'paused') return { state, period };
  period.status = 'paused';
  period.pausedAt = now;
  period.conflictNote = null;
  touchStatus(period, now);
  return { state, period };
}

export function resumePeriod(state, periodId, { now = new Date().toISOString() } = {}) {
  ensurePeriodsArray(state);
  const period = getPeriodById(state, periodId);
  if (!period) {
    const error = new Error('period_not_found');
    error.code = 'period_not_found';
    throw error;
  }
  if (period.status === 'completed') {
    const error = new Error('period_completed');
    error.code = 'period_completed';
    throw error;
  }
  const active = getActivePeriod(state);
  if (active && active.id !== periodId) {
    const error = new Error('active_period_exists');
    error.code = 'active_period_exists';
    throw error;
  }
  period.status = 'active';
  period.pausedAt = null;
  period.conflictNote = null;
  touchStatus(period, now);
  normalizeActivePeriods(state, { now });
  return { state, period };
}

export function submitPeriodAnswer(state, periodId, questionId, role, text, {
  now = new Date().toISOString()
} = {}) {
  ensurePeriodsArray(state);
  const period = getPeriodById(state, periodId);
  if (!period) {
    const error = new Error('period_not_found');
    error.code = 'period_not_found';
    throw error;
  }
  if (period.status !== 'active') {
    const error = new Error('period_not_active');
    error.code = 'period_not_active';
    throw error;
  }
  if (role !== 'a' && role !== 'b') {
    const error = new Error('invalid_role');
    error.code = 'invalid_role';
    throw error;
  }
  const question = period.contentSnapshot?.questions?.find((q) => q.id === questionId);
  if (!question) {
    const error = new Error('question_not_in_period');
    error.code = 'question_not_in_period';
    throw error;
  }
  const trimmed = String(text || '').trim();
  if (trimmed.length < 1) {
    const error = new Error('empty_answer');
    error.code = 'empty_answer';
    throw error;
  }
  if (!isQuestionUnlocked(period, question, new Date(now))) {
    const error = new Error('question_locked');
    error.code = 'question_locked';
    throw error;
  }

  const beforeMutual = countMutualAnswers(period);
  period.answers = period.answers || {};
  const slot = { ...(period.answers[questionId] || {}) };
  const prev = slot[role];
  slot[role] = {
    text: trimmed,
    submittedAt: prev?.submittedAt || now,
    updatedAt: now
  };
  period.answers[questionId] = slot;
  touch(period, now); // content only — does not bump statusVersion

  const afterMutual = countMutualAnswers(period);
  const progress = derivePeriodProgress(period);
  let completed = false;
  if (afterMutual >= REQUIRED_QUESTION_COUNT && period.status !== 'completed') {
    period.status = 'completed';
    period.completedAt = now;
    touchStatus(period, now);
    completed = true;
  }

  return {
    state,
    period,
    progress,
    mutualIncreased: afterMutual > beforeMutual,
    completed,
    bloomEvent: completed
  };
}

export function setChallengeDone(state, periodId, role, done = true, { now = new Date().toISOString() } = {}) {
  ensurePeriodsArray(state);
  const period = getPeriodById(state, periodId);
  if (!period) {
    const error = new Error('period_not_found');
    error.code = 'period_not_found';
    throw error;
  }
  if (role !== 'a' && role !== 'b') {
    const error = new Error('invalid_role');
    error.code = 'invalid_role';
    throw error;
  }
  period.challenge = period.challenge || {};
  period.challenge[role] = { done: Boolean(done), updatedAt: now };
  touch(period, now);
  return { state, period };
}

export function periodViewModel(period, { now = new Date(), role = 'a' } = {}) {
  if (!period) return null;
  const progress = derivePeriodProgress(period);
  const current = currentPeriodQuestion(period, now);
  const partner = role === 'a' ? 'b' : 'a';
  let waiting = null;
  if (current) {
    const slot = period.answers?.[current.id] || {};
    waiting = {
      meAnswered: hasNonEmptyAnswer(slot[role]),
      partnerAnswered: hasNonEmptyAnswer(slot[partner]),
      bothAnswered: hasNonEmptyAnswer(slot.a) && hasNonEmptyAnswer(slot.b)
    };
  }
  return {
    period,
    progress,
    currentQuestion: current,
    waiting,
    snapshot: period.contentSnapshot
  };
}
