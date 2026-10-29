import { escapeHtml, safeHttpUrl, safeImageUrl } from '../../ui/escapeHtml.js';
import { createList, updateList, deleteList, getListItems } from '../../domain/lists/model.js';
import {
  PRIORITY_LABELS,
  visibleItemForRole,
  reserveListItem,
  completeListItem,
  completionCopy,
  formatMoney,
  normalizeWishPatch,
  sortListItems,
  applyProductMetadata
} from '../../domain/wishlist/model.js';
import { createListItem, updateListItem, deleteListItem } from '../../domain/lists/model.js';

const ICONS = ['✨', '🎁', '🍴', '🎬', '✈️', '❤️', '🏠', '🌿', '📚', '🎵'];

export function renderOurs(ctx) {
  const lists = ctx.state.lists || [];
  const sheet = ctx.ui.sheet === 'new-list' ? newListSheet(ctx) : '';
  return `
    <section class="page-head">
      <div class="dashboard-copy">
        <div class="eyebrow">Наше</div>
        <h1>Что мы хотим вместе</h1>
        <p>Желания, места, фильмы и поездки. Пока это план — потом это может стать воспоминанием.</p>
      </div>
    </section>
    <div class="list-grid">
      ${lists.map((list) => listTile(ctx, list)).join('')}
      <button class="list-tile list-tile-add" type="button" data-action="new-list">
        <span>＋</span>
        <b>Новый список</b>
        <small>Своё название и настроение</small>
      </button>
    </div>
    <button class="plus-quiet" type="button" data-nav="packs" data-plus-source="ours">
      <span>
        <b>Ближе Plus</b>
        <small>Одна подписка на двоих. Пока только собираем интерес.</small>
      </span>
    </button>
    ${sheet}`;
}

export function renderList(ctx) {
  const list = (ctx.state.lists || []).find((item) => item.id === ctx.route.listId);
  if (!list) {
    return `<section class="empty-state glass-card"><div>✨</div><h2>Список не найден</h2><p>Возможно, его уже убрали.</p><button class="primary" data-nav="ours">К нашим спискам</button></section>`;
  }
  const items = sortListItems(getListItems(ctx.state, list.id).map((item) => visibleItemForRole(ctx.state, item, ctx.role)));
  const prompt = ctx.ui.prompt?.listId === list.id ? promptCard(ctx, list) : '';
  const sheet = ctx.ui.sheet === 'item' ? itemSheet(ctx, list) : '';
  return `
    <section class="page-head">
      <div class="dashboard-copy">
        <button class="text-back" type="button" data-nav="ours">← Наше</button>
        <h1>${escapeHtml(list.icon)} ${escapeHtml(list.name)}</h1>
        <p>${list.type === 'wishlist' ? 'Сохраните то, что однажды хочется получить.' : 'Отметьте, когда это случится — и оставьте момент в истории.'}</p>
      </div>
    </section>
    ${prompt}
    ${
      items.length
        ? `<div class="wish-list">${items.map((item) => itemCard(item, list, ctx.role)).join('')}</div>`
        : `<section class="empty-state glass-card"><div>${escapeHtml(list.icon || '✨')}</div><h2>${emptyTitle(list)}</h2><p>${emptyText(list)}</p></section>`
    }
    <button class="fab" type="button" data-action="add-item" aria-label="Добавить">＋</button>
    <section class="settings-card list-manage">
      <label class="setting-field">Название списка<input id="list-name-input" value="${escapeHtml(list.name)}" maxlength="60"></label>
      <div class="button-row wrap">
        <button class="secondary" type="button" id="rename-list">Сохранить название</button>
        <button class="danger" type="button" id="delete-list">Удалить список</button>
      </div>
    </section>
    ${sheet}`;
}

export function bindOurs(ctx) {
  document.querySelector('[data-action="new-list"]')?.addEventListener('click', () => {
    ctx.ui.sheet = 'new-list';
    ctx.ui.draft = { name: '', icon: '✨' };
    ctx.rerender();
  });
  document.querySelector('[data-action="close-sheet"]')?.addEventListener('click', () => {
    ctx.ui.sheet = null;
    ctx.rerender();
  });
  document.querySelectorAll('[data-icon]').forEach((button) => {
    button.addEventListener('click', () => {
      ctx.ui.draft = { ...(ctx.ui.draft || {}), icon: button.dataset.icon };
      document.querySelectorAll('[data-icon]').forEach((el) => el.classList.toggle('active', el.dataset.icon === button.dataset.icon));
    });
  });
  document.getElementById('new-list-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    const list = createList(ctx.state, { name, icon: ctx.ui.draft?.icon || '✨', type: 'custom' }, { actorRole: ctx.role });
    if (!list) return ctx.toast('Назовите список', 'warn');
    ctx.ui.sheet = null;
    await ctx.commit();
    ctx.toast('Список появился');
    ctx.nav('list', { listId: list.id });
  });
}

export function bindList(ctx) {
  const list = (ctx.state.lists || []).find((item) => item.id === ctx.route.listId);
  document.querySelector('[data-action="add-item"]')?.addEventListener('click', () => openItemSheet(ctx, null));
  document.querySelector('[data-action="close-sheet"]')?.addEventListener('click', () => {
    ctx.ui.sheet = null;
    ctx.rerender();
  });
  document.querySelectorAll('[data-edit-item]').forEach((button) => {
    button.addEventListener('click', () => openItemSheet(ctx, button.dataset.editItem));
  });
  document.querySelectorAll('[data-priority]').forEach((button) => {
    button.addEventListener('click', () => {
      const hidden = document.getElementById('item-priority');
      if (hidden) hidden.value = button.dataset.priority;
      document.querySelectorAll('[data-priority]').forEach((el) => el.classList.toggle('active', el === button));
    });
  });
  document.getElementById('fetch-preview')?.addEventListener('click', () => fetchPreview(ctx));
  document.getElementById('refresh-preview')?.addEventListener('click', () => fetchPreview(ctx, true));
  document.getElementById('item-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!list) return;
    const patch = normalizeWishPatch(readItemForm(event.currentTarget));
    const editing = ctx.ui.editingItemId;
    const saved = editing
      ? updateListItem(ctx.state, editing, patch, { actorRole: ctx.role })
      : createListItem(ctx.state, { ...patch, listId: list.id }, { actorRole: ctx.role });
    if (!saved) return ctx.toast('Добавьте название', 'warn');
    ctx.ui.sheet = null;
    ctx.ui.editingItemId = null;
    await ctx.commit();
    ctx.toast(editing ? 'Сохранили' : 'Добавили в список');
  });
  document.querySelectorAll('[data-reserve]').forEach((button) => {
    button.addEventListener('click', async () => {
      const result = reserveListItem(ctx.state, button.dataset.reserve, { actorRole: ctx.role });
      if (!result.ok) return ctx.toast('Это желание уже ваше', 'warn');
      await ctx.commit();
      ctx.toast('Сюрприз отмечен 🎁');
    });
  });
  document.querySelectorAll('[data-complete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const result = completeListItem(ctx.state, button.dataset.complete, { actorRole: ctx.role });
      if (!result) return;
      ctx.ui.prompt = { listId: list.id, itemId: result.item.id, draft: result.momentDraft };
      await ctx.commit();
    });
  });
  document.querySelector('[data-action="make-moment"]')?.addEventListener('click', () => {
    ctx.ui.momentDraft = ctx.ui.prompt?.draft || null;
    ctx.ui.prompt = null;
    ctx.ui.pendingMedia = [];
    ctx.ui.armDraft = true;
    ctx.nav('moment', { momentId: 'new' });
  });
  document.querySelector('[data-action="dismiss-prompt"]')?.addEventListener('click', () => {
    ctx.ui.prompt = null;
    ctx.rerender();
  });
  document.querySelectorAll('[data-delete-item]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Убрать из списка?')) return;
      deleteListItem(ctx.state, button.dataset.deleteItem);
      await ctx.commit();
    });
  });
  document.getElementById('rename-list')?.addEventListener('click', async () => {
    const name = document.getElementById('list-name-input')?.value;
    updateList(ctx.state, list.id, { name, icon: list.icon });
    await ctx.commit();
    ctx.toast('Название обновлено');
  });
  document.getElementById('delete-list')?.addEventListener('click', async () => {
    if (!confirm('Удалить список и всё, что в нём?')) return;
    deleteList(ctx.state, list.id);
    ctx.ui.prompt = null;
    await ctx.commit();
    ctx.nav('ours');
  });
}

function openItemSheet(ctx, itemId) {
  const stored = itemId ? (ctx.state.listItems || []).find((item) => item.id === itemId) : null;
  const visible = stored ? visibleItemForRole(ctx.state, stored, ctx.role) : null;
  ctx.ui.sheet = 'item';
  ctx.ui.editingItemId = itemId;
  ctx.ui.draft = visible
    ? {
        title: visible.title,
        description: visible.description,
        url: visible.url,
        imageUrl: visible.imageUrl,
        priority: visible.priority,
        status: visible.status,
        price: visible.metadata?.price ?? '',
        oldPrice: visible.metadata?.oldPrice ?? '',
        currency: visible.metadata?.currency || 'RUB',
        store: visible.metadata?.store || '',
        note: visible.metadata?.note || ''
      }
    : { priority: 'normal', currency: 'RUB', status: 'active' };
  ctx.rerender();
}

async function fetchPreview(ctx, force = false) {
  const input = document.getElementById('item-url');
  const status = document.getElementById('preview-status');
  const url = input?.value?.trim();
  if (!url) return ctx.toast('Вставьте ссылку', 'warn');
  if (status) status.textContent = 'Получаем информацию о товаре…';
  try {
    const meta = await ctx.metadataProvider.fetch(url, { force });
    const merged = applyProductMetadata(readItemForm(document.getElementById('item-form')), meta);
    fillItemForm(merged);
    if (status) status.textContent = meta.source === 'fallback' ? 'Нашли магазин. Остальное можно дописать.' : 'Можно поправить и сохранить.';
  } catch {
    if (status) status.textContent = 'Не получилось подтянуть данные. Заполните карточку вручную.';
    ctx.toast('Ссылку сохраним, детали можно вписать сами', 'warn');
  }
}

function listTile(ctx, list) {
  const count = getListItems(ctx.state, list.id).length;
  return `<button class="list-tile" type="button" data-nav="list" data-list="${escapeHtml(list.id)}">
    <span>${escapeHtml(list.icon || '✨')}</span>
    <b>${escapeHtml(list.name)}</b>
    <small>${count ? `${count} ${countLabel(count)}` : 'Пока пусто'}</small>
  </button>`;
}

function itemCard(item, list, role) {
  const image = safeImageUrl(item.imageUrl);
  const href = safeHttpUrl(item.url);
  const price = formatMoney(item.metadata?.price, item.metadata?.currency);
  const oldPrice = formatMoney(item.metadata?.oldPrice, item.metadata?.currency);
  const priority = PRIORITY_LABELS[item.priority] || PRIORITY_LABELS.normal;
  const done = item.status === 'purchased' || item.status === 'done';
  return `<article class="wish-card ${done ? 'is-done' : ''}">
    ${image ? `<img src="${escapeHtml(image)}" alt="" />` : `<div class="wish-fallback">${escapeHtml(list.icon || '✨')}</div>`}
    <div class="wish-copy">
      <div class="wish-meta"><span class="pill">${escapeHtml(priority)}</span>${statusPill(item, list)}</div>
      <h3>${escapeHtml(item.title)}</h3>
      ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
      ${price ? `<div class="wish-price"><b>${escapeHtml(price)}</b>${oldPrice ? `<s>${escapeHtml(oldPrice)}</s>` : ''}</div>` : ''}
      ${item.metadata?.store ? `<small class="muted">${escapeHtml(item.metadata.store)}</small>` : ''}
      ${item.metadata?.note ? `<small class="muted">${escapeHtml(item.metadata.note)}</small>` : ''}
      <div class="button-row wrap">
        ${href ? `<a class="ghost" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Открыть</a>` : ''}
        <button class="ghost" type="button" data-edit-item="${escapeHtml(item.id)}">Изменить</button>
        ${canReserve(item, list, role) ? `<button class="secondary" type="button" data-reserve="${escapeHtml(item.id)}">🎁 Я подарю это</button>` : ''}
        ${item.status === 'reserved' && !item.reservationHidden ? `<span class="pill">🎁 Сюрприз</span>` : ''}
        ${!done && item.status !== 'archived' ? `<button class="primary" type="button" data-complete="${escapeHtml(item.id)}">${completeLabel(list)}</button>` : ''}
        <button class="danger" type="button" data-delete-item="${escapeHtml(item.id)}">Убрать</button>
      </div>
    </div>
  </article>`;
}

function canReserve(item, list, role) {
  return list.type === 'wishlist' && item.status === 'active' && item.createdBy !== role;
}

function statusPill(item, list) {
  if (item.status === 'purchased') return '<span class="pill pill-soft">Куплено</span>';
  if (item.status === 'done') return `<span class="pill pill-soft">${list.type === 'places' ? 'Были' : 'Сделано'}</span>`;
  if (item.status === 'archived') return '<span class="pill pill-soft">В архиве</span>';
  return '';
}

function completeLabel(list) {
  if (list.type === 'wishlist') return 'Уже сбылось';
  if (list.type === 'places') return 'Мы сходили ❤️';
  if (list.type === 'trips') return 'Съездили';
  if (list.type === 'watch') return 'Посмотрели';
  return 'Сделано';
}

function promptCard(ctx, list) {
  const item = (ctx.state.listItems || []).find((entry) => entry.id === ctx.ui.prompt.itemId);
  const copy = completionCopy(list, item);
  return `<section class="moment-prompt">
    <div>
      <b>${copy.headline.startsWith('Желание') ? '🎉 ' : ''}${escapeHtml(copy.headline)}</b>
      <p>${escapeHtml(copy.body)}</p>
    </div>
    <div class="button-row wrap">
      <button class="primary" type="button" data-action="make-moment">${escapeHtml(copy.action)}</button>
      <button class="ghost" type="button" data-action="dismiss-prompt">Не сейчас</button>
    </div>
  </section>`;
}

function newListSheet() {
  return `<div class="sheet-backdrop"><form class="sheet" id="new-list-form">
    <div class="sheet-handle"></div>
    <h2>Новый список</h2>
    <label class="setting-field">Название<input name="name" maxlength="60" required placeholder="Например, книги"></label>
    <div class="icon-pick">${ICONS.map((icon) => `<button type="button" data-icon="${icon}" class="${icon === '✨' ? 'active' : ''}">${icon}</button>`).join('')}</div>
    <div class="button-row">
      <button class="ghost" type="button" data-action="close-sheet">Закрыть</button>
      <button class="primary" type="submit">Создать</button>
    </div>
  </form></div>`;
}

function itemSheet(ctx, list) {
  const draft = ctx.ui.draft || {};
  const wishlist = list.type === 'wishlist';
  const priorities = [
    ['normal', '🤍 Хочу'],
    ['high', '❤️ Очень хочу'],
    ['dream', '✨ Мечта']
  ];
  return `<div class="sheet-backdrop"><form class="sheet" id="item-form">
    <div class="sheet-handle"></div>
    <h2>${ctx.ui.editingItemId ? 'Изменить' : wishlist ? 'Новое желание' : 'Добавить'}</h2>
    ${wishlist ? `<label class="setting-field">Ссылка<input id="item-url" name="url" inputmode="url" placeholder="Вставьте ссылку на товар" value="${escapeHtml(draft.url || '')}"></label>
      <div class="button-row wrap">
        <button class="secondary" type="button" id="fetch-preview">Подтянуть данные</button>
        <button class="ghost" type="button" id="refresh-preview">Обновить информацию</button>
      </div>
      <p class="microcopy" id="preview-status"></p>` : `<label class="setting-field">Ссылка<input id="item-url" name="url" value="${escapeHtml(draft.url || '')}" placeholder="Необязательно"></label>`}
    <label class="setting-field">Название<input id="item-title" name="title" required maxlength="180" value="${escapeHtml(draft.title || '')}" placeholder="${wishlist ? 'Что хочется' : 'Название'}"></label>
    <label class="setting-field">Описание<textarea id="item-description" name="description" maxlength="2000" rows="3">${escapeHtml(draft.description || '')}</textarea></label>
    ${wishlist ? `<div class="price-row">
        <label class="setting-field">Цена<input id="item-price" name="price" inputmode="decimal" value="${escapeHtml(draft.price ?? '')}"></label>
        <label class="setting-field">Старая цена<input id="item-old-price" name="oldPrice" inputmode="decimal" value="${escapeHtml(draft.oldPrice ?? '')}"></label>
      </div>
      <label class="setting-field">Магазин<input id="item-store" name="store" value="${escapeHtml(draft.store || '')}"></label>
      <label class="setting-field">Фото<input id="item-image" name="imageUrl" value="${escapeHtml(draft.imageUrl || '')}" placeholder="Ссылка на изображение"></label>
      <label class="setting-field">Заметка<textarea id="item-note" name="note" rows="2">${escapeHtml(draft.note || '')}</textarea></label>
      <input type="hidden" name="currency" value="${escapeHtml(draft.currency || 'RUB')}">
      <div class="chip-row" role="group" aria-label="Насколько хочется">
        ${priorities.map(([id, label]) => `<button type="button" data-priority="${id}" class="${(draft.priority || 'normal') === id ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      <input type="hidden" id="item-priority" name="priority" value="${escapeHtml(draft.priority || 'normal')}">` : `<label class="setting-field">Когда планируете<input name="plannedDate" type="date" value="${escapeHtml(draft.plannedDate || '')}"></label>
      <input type="hidden" id="item-priority" name="priority" value="normal">`}
    <input type="hidden" name="status" value="${escapeHtml(draft.status || 'active')}">
    <div class="button-row">
      <button class="ghost" type="button" data-action="close-sheet">Закрыть</button>
      <button class="primary" type="submit">Сохранить</button>
    </div>
  </form></div>`;
}

function readItemForm(form) {
  if (!form) return {};
  const data = new FormData(form);
  return {
    title: data.get('title'),
    description: data.get('description'),
    url: data.get('url'),
    imageUrl: data.get('imageUrl'),
    price: data.get('price'),
    oldPrice: data.get('oldPrice'),
    currency: data.get('currency') || 'RUB',
    store: data.get('store'),
    note: data.get('note'),
    priority: data.get('priority') || 'normal',
    status: data.get('status') || 'active',
    metadata: { plannedDate: data.get('plannedDate') || null }
  };
}

function fillItemForm(patch) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el && value != null && value !== '') el.value = value;
  };
  set('item-title', patch.title);
  set('item-description', patch.description);
  set('item-url', patch.url);
  set('item-image', patch.imageUrl);
  set('item-price', patch.metadata?.price);
  set('item-old-price', patch.metadata?.oldPrice);
  set('item-store', patch.metadata?.store);
}

function emptyTitle(list) {
  if (list.type === 'wishlist') return 'Здесь пока нет желаний ✨';
  return 'Пока тихо';
}

function emptyText(list) {
  if (list.type === 'wishlist') return 'Сохраните то, что однажды хочется получить.';
  if (list.type === 'trips') return 'Куда хочется уехать вместе — можно начать с одного города.';
  if (list.type === 'places') return 'Ресторан, прогулка или место, куда тянет вернуться.';
  if (list.type === 'watch') return 'Фильм на вечер, который не хочется смотреть в одиночку.';
  return 'Добавьте первую идею, когда она появится.';
}

function countLabel(count) {
  const m10 = count % 10;
  const m100 = count % 100;
  if (m10 === 1 && m100 !== 11) return 'запись';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'записи';
  return 'записей';
}
