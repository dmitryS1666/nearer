import { createId } from '../ids.js';
import { newEntity, touch } from '../syncMeta.js';
import { calendarDateString } from '../LocalCoupleRepository.js';
import { currentCircleId, entitiesForCircle } from '../garden/ownership.js';

export function getImportantDates(state) {
  const circle = currentCircleId(state);
  const list = circle ? entitiesForCircle(state.importantDates, circle) : [...(state.importantDates || [])];
  return list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function createImportantDate(state, input, { now = new Date().toISOString(), idFactory = createId } = {}) {
  const title = String(input?.title || '').trim();
  const date = String(input?.date || '').trim();
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!Array.isArray(state.importantDates)) state.importantDates = [];
  const entry = newEntity(
    {
      id: idFactory(),
      circleId: currentCircleId(state) || state.circleId || null,
      title: title.slice(0, 120),
      date,
      repeatYearly: input.repeatYearly !== false,
      personId: input.personId || null,
      reminder: {
        enabled: input.reminder?.enabled !== false,
        daysBefore: Number(input.reminder?.daysBefore ?? input.daysBefore ?? 7) || 7
      }
    },
    now
  );
  state.importantDates.push(entry);
  return entry;
}

export function updateImportantDate(state, id, patch, { now = new Date().toISOString() } = {}) {
  const entry = (state.importantDates || []).find((item) => item.id === id);
  if (!entry) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) entry.title = patch.title.trim().slice(0, 120);
  if (typeof patch.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) entry.date = patch.date;
  if (typeof patch.repeatYearly === 'boolean') entry.repeatYearly = patch.repeatYearly;
  if ('personId' in patch) entry.personId = patch.personId || null;
  if (patch.reminder) entry.reminder = { ...entry.reminder, ...patch.reminder };
  touch(entry, now);
  return entry;
}

export function deleteImportantDate(state, id) {
  const before = (state.importantDates || []).length;
  state.importantDates = (state.importantDates || []).filter((item) => item.id !== id);
  return state.importantDates.length !== before;
}

export function nextOccurrence(dateStr, repeatYearly, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  const [, month, day] = dateStr.split('-').map(Number);
  if (!repeatYearly) return dateStr;
  const year = today.getFullYear();
  const todayKey = calendarDateString(today);
  let candidate = safeMonthDay(year, month, day);
  if (candidate < todayKey) candidate = safeMonthDay(year + 1, month, day);
  return candidate;
}

export function daysUntil(dateStr, today = new Date()) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / 86400000);
}

export function formatRange(start, end) {
  if (!start) return '';
  const a = dateParts(start);
  if (!a) return start;
  if (!end || end === start) return `${a.day} ${a.month} ${a.year}`;
  const b = dateParts(end);
  if (!b) return `${a.day} ${a.month} ${a.year}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${a.month} ${a.year}`;
  if (a.year === b.year) return `${a.day} ${a.month} – ${b.day} ${b.month} ${a.year}`;
  return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
}

export function formatDayLabel(dateStr) {
  const parts = dateParts(dateStr);
  if (!parts) return dateStr || '';
  return `${parts.day} ${parts.month}`;
}

function dateParts(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1) return null;
  const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(date);
  return { year, month: monthName, day };
}

function safeMonthDay(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1) return calendarDateString(new Date(year, 1, 28));
  return calendarDateString(date);
}
