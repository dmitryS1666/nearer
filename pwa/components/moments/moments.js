import { escapeHtml, safeHttpUrl, safeImageUrl } from '../../ui/escapeHtml.js';
import { createMoment, updateMoment, deleteMoment, setMomentFavorite, getMoment, MOMENT_TYPES, momentTypeMeta } from '../../domain/moments/model.js';
import { attachMedia, removeMedia, setCoverFromMedia, mediaForMoment } from '../../domain/media/model.js';
import { formatRange } from '../../domain/dates/model.js';
import { isWfolioUrl } from '../../integrations/wfolio/wfolio.js';
import { filesToAttachmentInputs } from '../../platform/photos/localPhotos.js';

export function renderMoments(ctx) {
  const moments = [...(ctx.state.moments || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return `
    <section class="page-head">
      <div class="dashboard-copy">
        <div class="eyebrow">Моменты</div>
        <h1>Ваша жизнь, не лента</h1>
        <p>Поездки, праздники, обычные дни, которые потом захочется вспомнить.</p>
      </div>
    </section>
    ${
      moments.length
        ? `<div class="moment-feed">${moments.map((moment) => momentCard(ctx, moment)).join('')}</div>`
        : `<section class="empty-state glass-card"><div>❤️</div><h2>Ваша история только начинается</h2><p>Сохраните первый момент.</p><button class="primary" type="button" data-nav="moment" data-moment="new">Сохранить момент</button></section>`
    }
    <button class="fab" type="button" data-nav="moment" data-moment="new" aria-label="Новый момент">＋</button>`;
}

export function renderMomentEditor(ctx) {
  const id = ctx.route.momentId;
  const existing = id && id !== 'new' ? getMoment(ctx.state, id) : null;
  if (id && id !== 'new' && !existing) {
    return `<section class="empty-state glass-card"><div>❤️</div><h2>Момент не найден</h2><button class="primary" data-nav="moments">К моментам</button></section>`;
  }
  const draft = existing || ctx.ui.momentDraft || {};
  const media = existing ? mediaForMoment(ctx.state, existing.id) : (ctx.ui.pendingMedia || []);
  const location = draft.location || { name: '', latitude: null, longitude: null };
  return `
    <section class="page-head">
      <div class="dashboard-copy">
        <button class="text-back" type="button" data-nav="moments">← Моменты</button>
        <h1>${existing ? 'Момент' : 'Что произошло?'}</h1>
        <p>Фото здесь живут вместе с историей, а не отдельной галереей.</p>
      </div>
    </section>
    <form id="moment-form" class="moment-form glass-card">
      <label class="setting-field">Что произошло?<input name="title" required maxlength="180" value="${escapeHtml(draft.title || '')}" placeholder="Наша поездка в Стамбул"></label>
      <div class="chip-row">
        ${MOMENT_TYPES.slice(0, 6).map((type) => `<label class="chip-check"><input type="radio" name="type" value="${type.id}" ${(draft.type || 'memory') === type.id ? 'checked' : ''}>${type.icon} ${type.label}</label>`).join('')}
      </div>
      <div class="price-row">
        <label class="setting-field">Когда<input name="date" type="date" value="${escapeHtml(draft.date || today())}"></label>
        <label class="setting-field">До<input name="endDate" type="date" value="${escapeHtml(draft.endDate || '')}"></label>
      </div>
      <label class="setting-field">Где<input name="location" value="${escapeHtml(location.name || '')}" placeholder="Стамбул"></label>
      <div class="price-row">
        <label class="setting-field">Широта<input name="latitude" inputmode="decimal" value="${escapeHtml(location.latitude ?? '')}" placeholder="необязательно"></label>
        <label class="setting-field">Долгота<input name="longitude" inputmode="decimal" value="${escapeHtml(location.longitude ?? '')}" placeholder="для будущей карты"></label>
      </div>
      <label class="setting-field">Описание<textarea name="description" rows="4" placeholder="Наша первая поездка туда вместе…">${escapeHtml(draft.description || '')}</textarea></label>
      <label class="setting-field">Люди<input name="people" value="${escapeHtml((draft.relatedPeople || []).join(', '))}" placeholder="Катя, Дима"></label>
      <label class="setting-field">Метки<input name="tags" value="${escapeHtml((draft.tags || []).join(', '))}" placeholder="отпуск, лето"></label>
      <label class="toggle-row"><span><b>❤️ В избранное</b><small>Попадёт в любимые моменты</small></span><input type="checkbox" name="favorite" ${draft.favorite ? 'checked' : ''}><i></i></label>
      ${mediaBlock(media, Boolean(existing))}
      <div class="photo-sources">
        <b>Фотографии</b>
        <label class="ghost file-btn">Телефон<input id="moment-files" type="file" accept="image/*" multiple></label>
        <label class="setting-field">Wfolio или ссылка на галерею<input id="gallery-url" placeholder="https://….wfolio…"></label>
        <button class="secondary" type="button" id="add-gallery">Добавить галерею</button>
        <p class="microcopy" id="gallery-status">Источник: телефон, Wfolio или ссылка.</p>
      </div>
      <div class="button-row wrap">
        <button class="primary" type="submit">${existing ? 'Сохранить' : 'Сохранить момент'}</button>
        ${existing ? `<button class="danger" type="button" id="delete-moment">Удалить момент</button>` : ''}
      </div>
    </form>`;
}

export function bindMoments() {}

export function bindMomentEditor(ctx) {
  const existing = ctx.route.momentId && ctx.route.momentId !== 'new' ? getMoment(ctx.state, ctx.route.momentId) : null;
  document.getElementById('moment-files')?.addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    if ((ctx.state.photoStorage || 'preview') === 'links') {
      ctx.toast('В этом режиме сохраняются только ссылки. Режим можно сменить в настройках.', 'warn');
      return;
    }
    const result = await filesToAttachmentInputs(files, ctx.state.photoStorage || 'preview');
    if (!result.inputs?.length) return ctx.toast('Не удалось прочитать фото', 'warn');
    rememberMomentDraft(ctx);
    if (existing) {
      for (const input of result.inputs) attachMedia(ctx.state, existing.id, input);
      await ctx.commit();
      ctx.toast('Фотографии добавлены');
      return;
    }
    ctx.ui.pendingMedia = [...(ctx.ui.pendingMedia || []), ...result.inputs.map((input, index) => ({ ...input, id: `pending-${Date.now()}-${index}` }))];
    ctx.rerender();
  });
  document.getElementById('add-gallery')?.addEventListener('click', () => addGallery(ctx, existing));
  document.querySelectorAll('[data-cover]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!existing) return;
      setCoverFromMedia(ctx.state, existing.id, button.dataset.cover);
      await ctx.commit();
    });
  });
  document.querySelectorAll('[data-remove-media]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (existing) {
        removeMedia(ctx.state, button.dataset.removeMedia);
        await ctx.commit();
        return;
      }
      ctx.ui.pendingMedia = (ctx.ui.pendingMedia || []).filter((item) => item.id !== button.dataset.removeMedia);
      ctx.rerender();
    });
  });
  document.getElementById('moment-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const patch = readMomentForm(event.currentTarget);
    if (existing) {
      updateMoment(ctx.state, existing.id, patch);
      await ctx.commit();
      ctx.toast('Момент сохранён');
      ctx.nav('moments');
      return;
    }
    const moment = createMoment(ctx.state, { ...patch, relatedListItems: ctx.ui.momentDraft?.relatedListItems || [] }, { actorRole: ctx.role });
    if (!moment) return ctx.toast('Напишите, что произошло', 'warn');
    for (const input of ctx.ui.pendingMedia || []) attachMedia(ctx.state, moment.id, input);
    ctx.ui.pendingMedia = [];
    ctx.ui.momentDraft = null;
    await ctx.commit();
    ctx.toast('Момент в вашей истории ❤️');
    ctx.nav('moments');
  });
  document.getElementById('delete-moment')?.addEventListener('click', async () => {
    if (!existing || !confirm('Удалить момент? Фото этого момента тоже исчезнут.')) return;
    deleteMoment(ctx.state, existing.id);
    await ctx.commit();
    ctx.nav('moments');
  });
}

async function addGallery(ctx, existing) {
  const input = document.getElementById('gallery-url');
  const status = document.getElementById('gallery-status');
  const url = input?.value?.trim();
  if (!url) return ctx.toast('Вставьте ссылку на галерею', 'warn');
  if (status) status.textContent = 'Смотрим галерею…';
  let attachment;
  try {
    if (isWfolioUrl(url)) attachment = await ctx.wfolio.importMedia({ galleryUrl: url });
    else {
      let meta = null;
      try { meta = await ctx.metadataProvider.fetch(url); } catch { meta = null; }
      attachment = {
        type: 'gallery',
        provider: 'external',
        sourceUrl: url,
        previewUrl: meta?.imageUrl || '',
        metadata: { title: meta?.title || 'Внешняя галерея', cover: meta?.imageUrl || '', embedUrl: null }
      };
    }
  } catch {
    if (status) status.textContent = 'Галерею сохраним как ссылку.';
    attachment = {
      type: 'gallery',
      provider: isWfolioUrl(url) ? 'wfolio' : 'external',
      sourceUrl: url,
      previewUrl: '',
      metadata: { title: 'Галерея', cover: '', embedUrl: null }
    };
  }
  if (existing) {
    attachMedia(ctx.state, existing.id, attachment);
    await ctx.commit();
    ctx.toast('Галерея прикреплена');
    return;
  }
  rememberMomentDraft(ctx);
  ctx.ui.pendingMedia = [...(ctx.ui.pendingMedia || []), { ...attachment, id: `pending-${Date.now()}` }];
  if (input) input.value = '';
  ctx.rerender();
}

function rememberMomentDraft(ctx) {
  const form = document.getElementById('moment-form');
  if (!form || ctx.route.momentId !== 'new') return;
  const data = new FormData(form);
  ctx.ui.momentDraft = {
    ...(ctx.ui.momentDraft || {}),
    title: data.get('title'),
    description: data.get('description'),
    date: data.get('date'),
    endDate: data.get('endDate') || null,
    type: data.get('type') || 'memory',
    favorite: data.get('favorite') === 'on',
    location: {
      name: data.get('location'),
      latitude: data.get('latitude'),
      longitude: data.get('longitude')
    },
    relatedPeople: String(data.get('people') || '').split(',').map((item) => item.trim()).filter(Boolean),
    tags: String(data.get('tags') || '').split(',').map((item) => item.trim()).filter(Boolean)
  };
}

function momentCard(ctx, moment) {
  const type = momentTypeMeta(moment.type);
  const photos = mediaForMoment(ctx.state, moment.id);
  const cover = safeImageUrl(moment.coverImage);
  return `<article class="moment-card">
    <button class="moment-open" type="button" data-nav="moment" data-moment="${escapeHtml(moment.id)}">
      ${cover ? `<img class="moment-cover" src="${escapeHtml(cover)}" alt="">` : `<div class="moment-cover moment-cover-empty">${type.icon}</div>`}
      <div class="moment-card-copy">
        <div class="question-meta"><span>${escapeHtml(formatRange(moment.date, moment.endDate))}</span><span class="pill">${type.icon} ${escapeHtml(type.label)}</span></div>
        <h3>${escapeHtml(moment.title)} ${moment.favorite ? '❤️' : ''}</h3>
        ${moment.location?.name ? `<p>📍 ${escapeHtml(moment.location.name)}</p>` : ''}
        <small>${photos.length ? `📷 ${photos.length}` : 'Пока без фото'}</small>
      </div>
    </button>
    <button class="ghost fav-btn" type="button" data-fav="${escapeHtml(moment.id)}">${moment.favorite ? 'В любимых' : '❤️ В избранное'}</button>
  </article>`;
}

export function bindMomentFavorites(ctx) {
  document.querySelectorAll('[data-fav]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const moment = getMoment(ctx.state, button.dataset.fav);
      if (!moment) return;
      setMomentFavorite(ctx.state, moment.id, !moment.favorite);
      await ctx.commit();
    });
  });
}

function mediaBlock(media, saved) {
  if (!media.length) return '<p class="microcopy">Обложкой станет первая фотография. Её можно сменить.</p>';
  return `<div class="photo-row">${media.map((item) => mediaThumb(item, saved)).join('')}</div>`;
}

function mediaThumb(item, saved) {
  const src = safeImageUrl(item.previewUrl || item.metadata?.cover || item.metadata?.thumbnail || '');
  const href = safeHttpUrl(item.sourceUrl);
  const title = item.metadata?.title || (item.provider === 'wfolio' ? 'Wfolio' : 'Фото');
  return `<figure class="photo-thumb">
    ${src ? `<img src="${escapeHtml(src)}" alt="">` : `<div class="wish-fallback">${item.provider === 'wfolio' ? '📷' : '🔗'}</div>`}
    <figcaption>${escapeHtml(title)}</figcaption>
    ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Открыть фотогалерею</a>` : ''}
    ${saved ? `<button type="button" data-cover="${escapeHtml(item.id)}">Сделать обложкой</button>` : ''}
    <button type="button" data-remove-media="${escapeHtml(item.id)}">Убрать</button>
  </figure>`;
}

function readMomentForm(form) {
  const data = new FormData(form);
  return {
    title: data.get('title'),
    description: data.get('description'),
    date: data.get('date'),
    endDate: data.get('endDate') || null,
    type: data.get('type') || 'memory',
    favorite: data.get('favorite') === 'on',
    location: {
      name: data.get('location'),
      latitude: data.get('latitude'),
      longitude: data.get('longitude')
    },
    relatedPeople: data.get('people'),
    tags: data.get('tags')
  };
}

function today() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
