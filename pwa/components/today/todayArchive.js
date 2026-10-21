import { escapeHtml, safeImageUrl } from '../../ui/escapeHtml.js';
import { collectReminders, memoryOnThisDay, thisWeekHighlights } from '../../domain/events/reminders.js';
import { formatDayLabel } from '../../domain/dates/model.js';

export function renderTodayArchive(state) {
  const memory = memoryOnThisDay(state);
  const reminders = collectReminders(state).slice(0, 2);
  const week = thisWeekHighlights(state).slice(0, 4);
  if (!memory && !reminders.length && !week.length) return '';
  const cover = safeImageUrl(memory?.coverImage);
  return `<section class="today-archive">
    ${memory ? `<button class="memory-peek" type="button" data-nav="moment" data-moment="${escapeHtml(memory.id)}">
      ${cover ? `<img src="${escapeHtml(cover)}" alt="">` : '<span>❤️</span>'}
      <div><small>Из нашей истории</small><b>${escapeHtml(yearsAgoLabel(memory.date))} ❤️</b><p>${escapeHtml(memory.title)}</p></div>
    </button>` : ''}
    ${reminders.map((item) => `<p class="today-reminder">${escapeHtml(item.title)}</p>`).join('')}
    ${week.length ? `<div class="week-block"><b>На этой неделе</b>${week.map((item) => `<button type="button" data-nav="${item.kind === 'plan' ? 'list' : 'history'}" ${item.listId ? `data-list="${escapeHtml(item.listId)}"` : ''}>${item.icon} ${escapeHtml(item.title)} <small>${escapeHtml(formatDayLabel(item.date))}</small></button>`).join('')}</div>` : ''}
  </section>`;
}

function yearsAgoLabel(dateStr) {
  const years = new Date().getFullYear() - Number(String(dateStr).slice(0, 4));
  if (years <= 1) return 'Год назад';
  const m10 = years % 10;
  const m100 = years % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${years} года назад`;
  return `${years} лет назад`;
}
