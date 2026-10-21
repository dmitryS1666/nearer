import { mediaForMoment } from '../media/model.js';

export function searchMemories(state, rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!query) return [];
  const hits = [];

  for (const moment of state.moments || []) {
    const media = mediaForMoment(state, moment.id);
    const blob = [
      moment.title,
      moment.description,
      moment.date,
      moment.endDate,
      moment.type,
      moment.location?.name,
      ...(moment.tags || []),
      ...(moment.relatedPeople || []),
      ...media.map((item) => item.metadata?.title || item.sourceUrl || '')
    ].join(' ').toLowerCase();
    if (blob.includes(query)) {
      hits.push({ kind: 'moment', id: moment.id, title: moment.title, date: moment.date, coverImage: moment.coverImage || '' });
    }
  }

  for (const item of state.listItems || []) {
    const list = (state.lists || []).find((candidate) => candidate.id === item.listId);
    const blob = [item.title, item.description, item.url, list?.name, item.metadata?.note, item.metadata?.store, item.metadata?.location?.name]
      .join(' ')
      .toLowerCase();
    if (blob.includes(query)) {
      hits.push({ kind: 'item', id: item.id, listId: item.listId, title: item.title, date: String(item.createdAt || '').slice(0, 10), icon: list?.icon || '✨' });
    }
  }

  for (const entry of state.importantDates || []) {
    const blob = `${entry.title} ${entry.date}`.toLowerCase();
    if (blob.includes(query)) hits.push({ kind: 'date', id: entry.id, title: entry.title, date: entry.date, icon: '🎂' });
  }

  for (const entry of state.history || []) {
    const blob = [entry.question, entry.category, entry.date, entry.calendarDate, entry.answers?.a?.text, entry.answers?.b?.text]
      .join(' ')
      .toLowerCase();
    if (blob.includes(query)) {
      hits.push({ kind: 'question', id: entry.calendarDate, title: entry.question, date: entry.calendarDate || '' });
    }
  }

  return hits;
}
