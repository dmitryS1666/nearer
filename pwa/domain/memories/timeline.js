import { momentTypeMeta } from '../moments/model.js';
import { mediaForMoment } from '../media/model.js';
import { formatDayLabel } from '../dates/model.js';

export function buildTimeline(state) {
  const events = [];

  if (state.startedUsingAt) {
    const date = String(state.startedUsingAt).slice(0, 10);
    events.push({
      id: 'started',
      kind: 'start',
      date,
      title: 'Начали использовать Ближе',
      icon: '❤️',
      text: 'С этого дня здесь копится ваша история.'
    });
  }

  for (const moment of state.moments || []) {
    const photos = mediaForMoment(state, moment.id);
    const type = momentTypeMeta(moment.type);
    events.push({
      id: moment.id,
      kind: 'moment',
      date: moment.date,
      endDate: moment.endDate,
      title: moment.title,
      icon: type.icon,
      text: moment.description || moment.location?.name || '',
      coverImage: moment.coverImage || '',
      photoCount: photos.length,
      favorite: Boolean(moment.favorite),
      location: moment.location?.name || ''
    });
  }

  for (const entry of state.history || []) {
    events.push({
      id: `q-${entry.calendarDate || entry.dayIndex}`,
      kind: 'question',
      date: entry.calendarDate || '',
      title: entry.question,
      icon: '💬',
      category: entry.category,
      displayDate: entry.date,
      answers: entry.answers,
      reaction: entry.reaction || ''
    });
  }

  for (const item of state.listItems || []) {
    if (item.status !== 'purchased' && item.status !== 'done') continue;
    const list = (state.lists || []).find((candidate) => candidate.id === item.listId);
    events.push({
      id: `item-${item.id}`,
      kind: 'done',
      date: String(item.updatedAt || item.createdAt || '').slice(0, 10),
      title: item.title,
      icon: list?.icon || '✨',
      text: list?.type === 'wishlist' ? 'Желание исполнилось' : 'Сделано вместе',
      listId: item.listId
    });
  }

  for (const entry of state.importantDates || []) {
    events.push({
      id: `date-${entry.id}`,
      kind: 'date',
      date: entry.date,
      title: entry.title,
      icon: '🎂',
      text: entry.repeatYearly === false ? 'Важная дата' : 'Каждый год',
      repeatYearly: entry.repeatYearly !== false
    });
  }

  const grouped = new Map();
  for (const event of events) {
    const year = /^\d{4}/.test(event.date || '') ? event.date.slice(0, 4) : 'Без даты';
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(event);
  }
  return [...grouped.entries()]
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    .map(([year, items]) => ({
      year,
      items: items.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    }));
}

export function timelineDayLabel(event) {
  if (event.displayDate && event.kind === 'question') return event.displayDate;
  return formatDayLabel(event.date);
}
