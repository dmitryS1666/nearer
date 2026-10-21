import { getValue, setValue, clearAll } from '../platform/storage.js';
import { loadQuestions, categoryLabel } from './questions.js';
import { SCHEMA_VERSION, migrateState } from './schema.js';
import { emptyDeviceLink } from './link.js';
import {
  getLists,
  getList,
  createList,
  updateList,
  deleteList,
  getListItems,
  getListItem,
  createListItem,
  updateListItem,
  deleteListItem
} from './lists/model.js';
import { reserveListItem, completeListItem } from './wishlist/model.js';
import {
  getMoments,
  getMoment,
  createMoment,
  updateMoment,
  deleteMoment
} from './moments/model.js';
import { attachMedia, removeMedia, clearLocalPhotoCache, setPhotoStorage } from './media/model.js';
import { getImportantDates, createImportantDate, deleteImportantDate } from './dates/model.js';

export { categoryLabel };

/**
 * CoupleRepository abstraction.
 * Current: LocalCoupleRepository (IndexedDB)
 * Future: SupabaseCoupleRepository
 *
 * UI must not know where data is physically stored.
 */

export function calendarDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addCalendarDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return calendarDateString(dt);
}

export const GARDEN_STAGES = [
  { id: 'seed', icon: '🌱', name: 'Семя', minDays: 0 },
  { id: 'sprout', icon: '🪴', name: 'Росток', minDays: 2 },
  { id: 'young', icon: '🌿', name: 'Молодое растение', minDays: 5 },
  { id: 'flowering', icon: '🌸', name: 'Цветение', minDays: 9 },
  { id: 'small-garden', icon: '🌷', name: 'Маленький сад', minDays: 14 },
  { id: 'mature', icon: '🌳', name: 'Зрелый сад', minDays: 21 }
];

export function gardenFromCompletedDays(completedDays) {
  let stage = GARDEN_STAGES[0];
  for (const s of GARDEN_STAGES) {
    if (completedDays >= s.minDays) stage = s;
  }
  const idx = GARDEN_STAGES.findIndex((s) => s.id === stage.id);
  const next = GARDEN_STAGES[idx + 1] || null;
  const prevMin = stage.minDays;
  const nextMin = next?.minDays ?? stage.minDays;
  const progress = !next
    ? 100
    : Math.max(5, Math.min(100, ((completedDays - prevMin) / Math.max(1, nextMin - prevMin)) * 100));
  return { stage, level: idx, next, progress, completedDays };
}

export function streakMilestone(streak) {
  const milestones = [3, 7, 14, 30];
  return milestones.includes(streak) ? streak : null;
}

export const initialState = {
  onboarded: false,
  profile: { name: 'Ты', partnerName: 'Партнёр' },
  currentRole: 'a',
  // Calendar-day question assignment
  calendarDate: null,
  questionId: null,
  dayIndex: 0,
  streak: 0,
  completedDays: 0,
  lastCompletedCalendarDate: null,
  answers: {},
  history: [],
  reactions: {},
  notificationPrefs: { daily: false, partner: false, reveal: false, streak: false },
  reminderTime: '20:00',
  reminderConfigured: false,
  plus: false,
  installDismissed: false,
  testLabUnlocked: false,
  testLab: {
    partnerAutoAnswer: true,
    partnerDelayMs: 15000
  },
  revealHapticDone: {},
  schemaVersion: SCHEMA_VERSION,
  circleId: null,
  startedUsingAt: null,
  defaultListsSeeded: false,
  lists: [],
  listItems: [],
  reservations: [],
  moments: [],
  mediaAttachments: [],
  importantDates: [],
  domainEvents: [],
  photoStorage: 'preview',
  deviceLink: emptyDeviceLink()
};

export class LocalCoupleRepository {
  constructor() {
    this.questions = [];
  }

  async init() {
    this.questions = await loadQuestions();
    return this;
  }

  allQuestions() {
    return this.questions;
  }

  getQuestionById(id) {
    return this.questions.find((q) => q.id === id) || this.questions[0];
  }

  questionForIndex(index) {
    return this.questions[Math.abs(index) % this.questions.length];
  }

  async loadState() {
    const saved = await getValue('state', null);
    const merged = !saved
      ? structuredClone(initialState)
      : {
          ...structuredClone(initialState),
          ...saved,
          profile: { ...initialState.profile, ...(saved.profile || {}) },
          notificationPrefs: { ...initialState.notificationPrefs, ...(saved.notificationPrefs || {}) },
          testLab: { ...initialState.testLab, ...(saved.testLab || {}) },
          revealHapticDone: { ...(saved.revealHapticDone || {}) }
        };
    const migrated = migrateState(merged);
    const needsWrite = !saved || saved.schemaVersion !== SCHEMA_VERSION || !saved.defaultListsSeeded;
    if (needsWrite) await this.saveState(migrated);
    return migrated;
  }

  getLists(state) { return getLists(state); }
  getList(state, id) { return getList(state, id); }
  createList(state, input, ctx) { return createList(state, input, ctx); }
  updateList(state, id, patch, ctx) { return updateList(state, id, patch, ctx); }
  deleteList(state, id) { return deleteList(state, id); }

  getListItems(state, listId) { return getListItems(state, listId); }
  getListItem(state, id) { return getListItem(state, id); }
  createListItem(state, input, ctx) { return createListItem(state, input, ctx); }
  updateListItem(state, id, patch, ctx) { return updateListItem(state, id, patch, ctx); }
  deleteListItem(state, id) { return deleteListItem(state, id); }
  reserveListItem(state, id, ctx) { return reserveListItem(state, id, ctx); }
  completeListItem(state, id, ctx) { return completeListItem(state, id, ctx); }

  getMoments(state) { return getMoments(state); }
  getMoment(state, id) { return getMoment(state, id); }
  createMoment(state, input, ctx) { return createMoment(state, input, ctx); }
  updateMoment(state, id, patch, ctx) { return updateMoment(state, id, patch, ctx); }
  deleteMoment(state, id) { return deleteMoment(state, id); }

  attachMedia(state, momentId, input, ctx) { return attachMedia(state, momentId, input, ctx); }
  removeMedia(state, mediaId, ctx) { return removeMedia(state, mediaId, ctx); }
  clearLocalPhotoCache(state, now) { return clearLocalPhotoCache(state, now); }
  setPhotoStorage(state, mode) { return setPhotoStorage(state, mode); }

  getImportantDates(state) { return getImportantDates(state); }
  createImportantDate(state, input, ctx) { return createImportantDate(state, input, ctx); }
  deleteImportantDate(state, id) { return deleteImportantDate(state, id); }

  async saveState(state) {
    await setValue('state', state);
  }

  async clearAllData() {
    await clearAll();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore
    }
  }

  /**
   * Ensure today's calendar date has an assigned question.
   * Does not change question on reload within the same calendar day.
   */
  ensureTodayQuestion(state, { forceNextDay = false } = {}) {
    const today = calendarDateString();
    if (forceNextDay) {
      const base = state.calendarDate || today;
      state.calendarDate = addCalendarDays(base, 1);
      state.dayIndex = (state.dayIndex || 0) + 1;
      state.questionId = this.questionForIndex(state.dayIndex).id;
      return state;
    }
    if (state.calendarDate === today && state.questionId) {
      return state;
    }
    // New calendar day
    if (state.calendarDate && state.calendarDate !== today) {
      state.dayIndex = (state.dayIndex || 0) + 1;
    }
    // First launch or migrated state without calendarDate
    if (!state.calendarDate) {
      state.dayIndex = state.dayIndex || 0;
    }
    state.calendarDate = today;
    state.questionId = this.questionForIndex(state.dayIndex || 0).id;
    return state;
  }

  todayKey(state) {
    return state.calendarDate || calendarDateString();
  }

  getTodayQuestion(state) {
    return this.getQuestionById(state.questionId) || this.questionForIndex(state.dayIndex || 0);
  }

  getPartnerState(state, role) {
    const key = this.todayKey(state);
    const answers = state.answers[key] || {};
    const partner = role === 'a' ? 'b' : 'a';
    return {
      meAnswered: Boolean(answers[role]?.text),
      partnerAnswered: Boolean(answers[partner]?.text),
      bothAnswered: Boolean(answers.a?.text && answers.b?.text),
      answers
    };
  }

  getHistory(state) {
    return [...(state.history || [])];
  }

  getStreak(state) {
    return state.streak || 0;
  }

  getGarden(state) {
    return gardenFromCompletedDays(state.completedDays || 0);
  }

  /** Placeholder for future realtime subscriptions */
  subscribeToCoupleEvents(_handler) {
    return () => {};
  }
}

export const coupleRepository = new LocalCoupleRepository();
