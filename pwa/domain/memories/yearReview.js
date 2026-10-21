import { mediaForMoment } from '../media/model.js';

/**
 * "Год вместе" — relationship wrapped.
 * Built from structured moments, lists and dates. Ready for a richer story later.
 */
export function buildYearReview(state, year, today = new Date()) {
  const key = String(year);
  const moments = (state.moments || []).filter((moment) => String(moment.date || '').startsWith(key));
  const photos = moments.reduce((sum, moment) => sum + mediaForMoment(state, moment.id).length, 0);
  const trips = moments.filter((moment) => moment.type === 'trip').length;
  const dates = moments.filter((moment) => moment.type === 'date' || moment.type === 'outing').length;
  const films = countDone(state, 'watch', key) + moments.filter((moment) => moment.type === 'watch').length;
  const wishes = countDone(state, 'wishlist', key);
  const highlights = [...moments]
    .sort((a, b) => Number(b.favorite) - Number(a.favorite))
    .filter((moment) => moment.coverImage || moment.favorite)
    .slice(0, 6);

  return {
    year: Number(key),
    title: `Наш ${key} год`,
    monthsTogether: monthsTogether(state, Number(key), today),
    trips,
    dates,
    moments: moments.length,
    photos,
    films,
    wishes,
    highlights
  };
}

export function availableReviewYears(state, today = new Date()) {
  const years = new Set();
  const add = (value) => {
    const year = String(value || '').slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(Number(year));
  };
  add(state.startedUsingAt);
  for (const moment of state.moments || []) add(moment.date);
  for (const entry of state.history || []) add(entry.calendarDate);
  for (const item of state.listItems || []) add(item.updatedAt || item.createdAt);
  if (!years.size) years.add(today.getFullYear());
  return [...years].sort((a, b) => b - a);
}

function countDone(state, listType, year) {
  const ids = new Set((state.lists || []).filter((list) => list.type === listType).map((list) => list.id));
  return (state.listItems || []).filter((item) => {
    if (!ids.has(item.listId)) return false;
    if (item.status !== 'purchased' && item.status !== 'done') return false;
    return String(item.updatedAt || item.createdAt || '').startsWith(year);
  }).length;
}

function monthsTogether(state, year, today) {
  const start = state.startedUsingAt ? new Date(state.startedUsingAt) : null;
  if (!start || Number.isNaN(start.getTime())) return 0;
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31);
  const windowStart = start > from ? start : from;
  const windowEnd = today < to ? today : to;
  if (windowEnd < windowStart) return 0;
  const months = (windowEnd.getFullYear() - windowStart.getFullYear()) * 12 + (windowEnd.getMonth() - windowStart.getMonth()) + 1;
  return Math.max(1, Math.min(12, months));
}
