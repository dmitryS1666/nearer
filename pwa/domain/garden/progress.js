import {
  QUESTION_SCHEDULE_DAYS,
  REQUIRED_QUESTION_COUNT,
  stageForMutualCount
} from './themes.js';

/** YYYY-MM-DD in a given IANA timezone. */
export function calendarDateInTimeZone(date = new Date(), timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }
}

export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Inclusive day index: startDate = day 1. */
export function periodDayNumber(period, now = new Date()) {
  const start = String(period?.startDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return 1;
  const tz = period.timeZone || 'UTC';
  const today = calendarDateInTimeZone(now, tz);
  const startUtc = Date.UTC(...start.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  const todayUtc = Date.UTC(...today.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  const diff = Math.floor((todayUtc - startUtc) / 86_400_000);
  return Math.max(1, diff + 1);
}

export function hasNonEmptyAnswer(entry) {
  return Boolean(entry && typeof entry.text === 'string' && entry.text.trim().length > 0);
}

export function isQuestionMutual(period, questionId) {
  const slot = period?.answers?.[questionId] || {};
  return hasNonEmptyAnswer(slot.a) && hasNonEmptyAnswer(slot.b);
}

export function countMutualAnswers(period) {
  const questions = period?.contentSnapshot?.questions || [];
  let n = 0;
  for (const q of questions) {
    if (isQuestionMutual(period, q.id)) n += 1;
  }
  return n;
}

export function derivePeriodProgress(period) {
  const mutualCount = countMutualAnswers(period);
  const progressPercent = Math.round((mutualCount / REQUIRED_QUESTION_COUNT) * 1000) / 10;
  const stage = stageForMutualCount(mutualCount);
  return { mutualCount, progressPercent, stage, required: REQUIRED_QUESTION_COUNT };
}

export function previousQuestionCompleted(period, questionOrder) {
  if (questionOrder <= 1) return true;
  const questions = period?.contentSnapshot?.questions || [];
  const prev = questions.find((q) => q.order === questionOrder - 1);
  if (!prev) return false;
  return isQuestionMutual(period, prev.id);
}

export function isQuestionUnlocked(period, question, now = new Date()) {
  if (!period || period.status !== 'active' || !question) return false;
  const day = periodDayNumber(period, now);
  const scheduleDay = QUESTION_SCHEDULE_DAYS[question.order - 1] ?? 99;
  if (day < scheduleDay) return false;
  return previousQuestionCompleted(period, question.order);
}

export function listUnlockedQuestions(period, now = new Date()) {
  const questions = period?.contentSnapshot?.questions || [];
  return questions.filter((q) => isQuestionUnlocked(period, q, now));
}

/** First unlocked question that is not yet mutual (current work item). */
export function currentPeriodQuestion(period, now = new Date()) {
  if (!period || period.status !== 'active') return null;
  const questions = [...(period.contentSnapshot?.questions || [])].sort((a, b) => a.order - b.order);
  for (const q of questions) {
    if (!isQuestionUnlocked(period, q, now)) continue;
    if (!isQuestionMutual(period, q.id)) return q;
  }
  return null;
}

export function nextQuestionScheduleInfo(period, now = new Date()) {
  if (!period || period.status !== 'active') return null;
  const day = periodDayNumber(period, now);
  const questions = [...(period.contentSnapshot?.questions || [])].sort((a, b) => a.order - b.order);
  for (const q of questions) {
    if (isQuestionMutual(period, q.id)) continue;
    const scheduleDay = QUESTION_SCHEDULE_DAYS[q.order - 1] ?? 99;
    const unlocked = isQuestionUnlocked(period, q, now);
    return {
      question: q,
      scheduleDay,
      periodDay: day,
      unlocked,
      waitingOnPrevious: !previousQuestionCompleted(period, q.order),
      daysUntilSchedule: Math.max(0, scheduleDay - day)
    };
  }
  return null;
}

export function periodConclusions(period) {
  const finalQ = (period?.contentSnapshot?.questions || []).find((q) => q.kind === 'final');
  if (!finalQ) return { a: null, b: null };
  const slot = period.answers?.[finalQ.id] || {};
  return {
    a: hasNonEmptyAnswer(slot.a) ? slot.a : null,
    b: hasNonEmptyAnswer(slot.b) ? slot.b : null,
    question: finalQ
  };
}
