import { DomainEventType } from './events.js';
import { daysUntil, nextOccurrence } from '../dates/model.js';
import { calendarDateString } from '../LocalCoupleRepository.js';

/**
 * Derived reminders. They are not pushed yet — the domain can surface them
 * and a future notification worker can schedule the same events.
 */
export function collectReminders(state, today = new Date()) {
  const reminders = [];
  const todayKey = calendarDateString(today);

  for (const entry of state.importantDates || []) {
    if (entry.reminder?.enabled === false) continue;
    const when = nextOccurrence(entry.date, entry.repeatYearly !== false, today);
    const distance = daysUntil(when, today);
    const lead = entry.reminder?.daysBefore ?? 7;
    if (distance == null || distance < 0 || distance > lead) continue;
    reminders.push({
      type: DomainEventType.ImportantDateApproaching,
      entityId: entry.id,
      date: when,
      title: distance === 0 ? `Сегодня ${entry.title} ❤️` : `Через ${distancePhrase(distance)} — ${entry.title} ❤️`
    });
  }

  for (const moment of state.moments || []) {
    if (!moment.date || moment.date.slice(5) !== todayKey.slice(5)) continue;
    const years = Number(todayKey.slice(0, 4)) - Number(moment.date.slice(0, 4));
    if (years < 1) continue;
    reminders.push({
      type: DomainEventType.MomentAnniversary,
      entityId: moment.id,
      date: todayKey,
      title: years === 1 ? `Год назад: ${moment.title}` : `${years} ${yearsPhrase(years)} назад: ${moment.title}`,
      coverImage: moment.coverImage || ''
    });
  }

  return reminders;
}

export function memoryOnThisDay(state, today = new Date()) {
  const todayKey = calendarDateString(today);
  const monthDay = todayKey.slice(5);
  const year = Number(todayKey.slice(0, 4));
  return (state.moments || [])
    .filter((moment) => moment.date && moment.date.slice(5) === monthDay && Number(moment.date.slice(0, 4)) < year)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

export function thisWeekHighlights(state, today = new Date()) {
  const items = [];
  for (const entry of state.importantDates || []) {
    const when = nextOccurrence(entry.date, entry.repeatYearly !== false, today);
    const distance = daysUntil(when, today);
    if (distance != null && distance >= 0 && distance <= 7) {
      items.push({ kind: 'date', id: entry.id, date: when, title: entry.title, icon: '🎂' });
    }
  }
  for (const item of state.listItems || []) {
    const planned = item.metadata?.plannedDate;
    if (!planned) continue;
    const distance = daysUntil(planned, today);
    if (distance == null || distance < 0 || distance > 7) continue;
    if (item.status === 'archived' || item.status === 'purchased' || item.status === 'done') continue;
    const list = (state.lists || []).find((candidate) => candidate.id === item.listId);
    items.push({
      kind: 'plan',
      id: item.id,
      listId: item.listId,
      date: planned,
      title: item.title,
      icon: list?.icon || '✨'
    });
  }
  return items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function distancePhrase(days) {
  if (days === 1) return 'день';
  const m10 = days % 10;
  const m100 = days % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${days} дня`;
  return `${days} дней`;
}

function yearsPhrase(years) {
  const m10 = years % 10;
  const m100 = years % 100;
  if (m10 === 1 && m100 !== 11) return 'год';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'года';
  return 'лет';
}
