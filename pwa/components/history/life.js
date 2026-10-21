import { escapeHtml, safeImageUrl } from '../../ui/escapeHtml.js';
import { buildTimeline, timelineDayLabel } from '../../domain/memories/timeline.js';
import { searchMemories } from '../../domain/memories/search.js';
import { availableReviewYears, buildYearReview } from '../../domain/memories/yearReview.js';
import { createImportantDate, deleteImportantDate, formatRange } from '../../domain/dates/model.js';

export function renderLife(ctx) {
  const query = ctx.ui.query || '';
  const years = availableReviewYears(ctx.state);
  const reviewYear = ctx.ui.reviewYear || years[0];
  const review = buildYearReview(ctx.state, reviewYear);
  const questions = ctx.state.plus ? (ctx.state.history || []) : (ctx.state.history || []).slice(-30);
  const timelineState = { ...ctx.state, history: questions };
  const groups = buildTimeline(timelineState);
  const hits = query.trim() ? searchMemories(ctx.state, query) : [];
  return `
    <section class="page-head">
      <div class="dashboard-copy">
        <div class="eyebrow">История</div>
        <h1>Как мы жили это время</h1>
        <p>Моменты, желания, даты и ваши ответы — одна линия, которая становится ценнее с каждым месяцем.</p>
      </div>
    </section>
    <label class="search-field">Поиск в нашей истории
      <input id="memory-search" value="${escapeHtml(query)}" placeholder="Стамбул, 2027, Новый год, Катя" autocomplete="off">
    </label>
    <div id="memory-results">${query.trim() ? renderHits(hits) : ''}</div>
    ${query.trim() ? '' : `${yearCard(review, years)}${datesBlock(ctx)}${renderGroups(ctx, groups)}`}
    ${
      !ctx.state.plus && (ctx.state.history || []).length >= 2
        ? `<section class="soft-paywall"><div><b>Полная история — в «Ближе Плюс»</b><p>Больше тем, развитие сада и будущие воспоминания.</p></div><button class="ghost" data-nav="packs">Смотреть Плюс</button></section>`
        : ''
    }
    ${ctx.ui.sheet === 'date' ? dateSheet() : ''}`;
}

export function bindLife(ctx) {
  document.getElementById('memory-search')?.addEventListener('input', (event) => {
    ctx.ui.query = event.target.value;
    const box = document.getElementById('memory-results');
    const rest = document.getElementById('life-rest');
    if (box) box.innerHTML = ctx.ui.query.trim() ? renderHits(searchMemories(ctx.state, ctx.ui.query)) : '';
    document.querySelectorAll('[data-life-body]').forEach((el) => {
      el.hidden = Boolean(ctx.ui.query.trim());
    });
    if (rest) rest.hidden = Boolean(ctx.ui.query.trim());
    bindHitNav(ctx);
  });
  document.querySelectorAll('[data-review-year]').forEach((button) => {
    button.addEventListener('click', () => {
      ctx.ui.reviewYear = Number(button.dataset.reviewYear);
      ctx.rerender();
      const input = document.getElementById('memory-search');
      if (input) input.focus();
    });
  });
  document.getElementById('add-date')?.addEventListener('click', () => {
    ctx.ui.sheet = 'date';
    ctx.rerender();
  });
  document.querySelector('[data-action="close-sheet"]')?.addEventListener('click', () => {
    ctx.ui.sheet = null;
    ctx.rerender();
  });
  document.getElementById('date-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = createImportantDate(ctx.state, {
      title: data.get('title'),
      date: data.get('date'),
      repeatYearly: data.get('repeat') === 'on'
    });
    if (!saved) return ctx.toast('Нужны название и дата', 'warn');
    ctx.ui.sheet = null;
    await ctx.commit();
    ctx.toast('Дата сохранена');
  });
  document.querySelectorAll('[data-delete-date]').forEach((button) => {
    button.addEventListener('click', async () => {
      deleteImportantDate(ctx.state, button.dataset.deleteDate);
      await ctx.commit();
    });
  });
  bindHitNav(ctx);
}

function renderGroups(ctx, groups) {
  const meaningful = groups.some((group) => group.items.some((item) => item.kind !== 'start'));
  if (!meaningful && !(ctx.state.moments || []).length) {
    return `<section class="empty-state glass-card" data-life-body><div>❤️</div><h2>История только начинается</h2><p>Первый завершённый день, желание или момент появятся здесь.</p><button class="primary" data-nav="today">К сегодняшнему вопросу</button></section>`;
  }
  return `<div data-life-body>${groups.map((group) => `
    <section class="year-block">
      <h2>${escapeHtml(group.year)}</h2>
      <div class="timeline">${group.items.map((item) => timelineItem(ctx, item)).join('')}</div>
    </section>`).join('')}</div>`;
}

function timelineItem(ctx, item) {
  if (item.kind === 'question') {
    return `<article class="timeline-item">
      <div class="timeline-rail" aria-hidden="true"><span class="timeline-dot"></span></div>
      <div class="timeline-card">
        <div class="question-meta"><span class="history-date">${escapeHtml(item.displayDate || timelineDayLabel(item))}</span><span class="pill">${escapeHtml(item.category || 'Вопрос')}</span></div>
        <h3>${escapeHtml(item.title || '')}</h3>
        <div class="mini-answers">
          <div><b>${escapeHtml(ctx.state.profile.name)}</b><p>${escapeHtml(item.answers?.a?.text || '—')}</p></div>
          <div><b>${escapeHtml(ctx.state.profile.partnerName)}</b><p>${escapeHtml(item.answers?.b?.text || '—')}</p></div>
        </div>
        ${item.reaction ? `<div class="history-reaction">${item.reaction}</div>` : ''}
      </div>
    </article>`;
  }
  const cover = safeImageUrl(item.coverImage);
  const open = item.kind === 'moment'
    ? `data-nav="moment" data-moment="${escapeHtml(item.id)}"`
    : item.kind === 'done' && item.listId
      ? `data-nav="list" data-list="${escapeHtml(item.listId)}"`
      : '';
  return `<article class="timeline-item">
    <div class="timeline-rail" aria-hidden="true"><span class="timeline-dot"></span></div>
    <div class="timeline-card life-card" ${open ? `role="button" tabindex="0" ${open}` : ''}>
      ${cover ? `<img class="life-cover" src="${escapeHtml(cover)}" alt="">` : ''}
      <div class="question-meta"><span class="history-date">${escapeHtml(timelineDayLabel(item))}</span><span>${item.icon || ''}</span></div>
      <h3>${escapeHtml(item.title || '')}</h3>
      ${item.location ? `<p class="muted">📍 ${escapeHtml(item.location)}</p>` : ''}
      ${item.text ? `<p class="muted">${escapeHtml(item.text)}</p>` : ''}
      ${item.photoCount ? `<small>📷 ${item.photoCount}</small>` : ''}
    </div>
  </article>`;
}

function yearCard(review, years) {
  const stats = [
    [`${review.monthsTogether}`, 'месяцев вместе'],
    [`${review.trips}`, 'путешествий'],
    [`${review.dates}`, 'встреч'],
    [`${review.moments}`, 'моментов'],
    [`${review.photos}`, 'фотографий'],
    [`${review.films}`, 'фильмов'],
    [`${review.wishes}`, 'исполненных желаний']
  ];
  return `<section class="year-review" data-life-body>
    <div class="eyebrow">Год вместе</div>
    <h2>${escapeHtml(review.title)} ❤️</h2>
    <div class="chip-row">${years.map((year) => `<button type="button" data-review-year="${year}" class="${year === review.year ? 'active' : ''}">${year}</button>`).join('')}</div>
    <div class="review-grid">${stats.map(([value, label]) => `<div><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></div>`).join('')}</div>
    ${
      review.highlights.length
        ? `<div class="review-photos">${review.highlights.map((moment) => {
            const src = safeImageUrl(moment.coverImage);
            return src
              ? `<button type="button" data-nav="moment" data-moment="${escapeHtml(moment.id)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(moment.title)}"></button>`
              : '';
          }).join('')}</div><p class="microcopy">Ваши самые яркие моменты</p>`
        : '<p class="microcopy">Когда появятся фотографии, здесь соберётся ваш год.</p>'
    }
  </section>`;
}

function datesBlock(ctx) {
  const dates = ctx.state.importantDates || [];
  return `<section class="settings-card" data-life-body>
    <div class="setting-title"><h2>Важные даты</h2><button class="secondary" type="button" id="add-date">Добавить</button></div>
    ${
      dates.length
        ? dates.map((entry) => `<div class="date-row"><div><b>${escapeHtml(entry.title)}</b><small>${escapeHtml(formatRange(entry.date))}${entry.repeatYearly === false ? '' : ' · каждый год'}</small></div><button class="ghost" type="button" data-delete-date="${escapeHtml(entry.id)}">Убрать</button></div>`).join('')
        : '<p class="muted">День знакомства, первое свидание, годовщина, дни рождения.</p>'
    }
  </section>`;
}

function dateSheet() {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `<div class="sheet-backdrop"><form class="sheet" id="date-form">
    <div class="sheet-handle"></div>
    <h2>Важная дата</h2>
    <label class="setting-field">Что это<input name="title" required maxlength="120" placeholder="День знакомства"></label>
    <label class="setting-field">Когда<input name="date" type="date" required value="${iso}"></label>
    <label class="toggle-row"><span><b>Каждый год</b><small>Напомним, когда дата снова близко</small></span><input name="repeat" type="checkbox" checked><i></i></label>
    <div class="button-row">
      <button class="ghost" type="button" data-action="close-sheet">Закрыть</button>
      <button class="primary" type="submit">Сохранить</button>
    </div>
  </form></div>`;
}

function renderHits(hits) {
  if (!hits.length) return '<section class="empty-state glass-card"><div>🔎</div><h2>Пока ничего не нашли</h2><p>Попробуйте место, год, имя или слово из заметки.</p></section>';
  return `<div class="hit-list">${hits.map((hit) => `<button type="button" class="hit" data-hit-kind="${hit.kind}" data-hit-id="${escapeHtml(hit.id)}" data-hit-list="${escapeHtml(hit.listId || '')}"><b>${escapeHtml(hit.title || '')}</b><small>${escapeHtml(hit.date || hit.kind)}</small></button>`).join('')}</div>`;
}

function bindHitNav(ctx) {
  document.querySelectorAll('[data-hit-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.hitKind === 'moment') ctx.nav('moment', { momentId: button.dataset.hitId });
      else if (button.dataset.hitKind === 'item') ctx.nav('list', { listId: button.dataset.hitList });
      else if (button.dataset.hitKind === 'question') ctx.nav('history');
      else ctx.nav('history');
    });
  });
}
