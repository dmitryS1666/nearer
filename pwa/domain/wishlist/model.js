import { createId } from '../ids.js';
import { recordEvent, DomainEventType } from '../events/events.js';
import { getList, getListItem, updateListItem } from '../lists/model.js';
import { touch } from '../syncMeta.js';

export const PRIORITIES = ['low', 'normal', 'high', 'dream'];

export const PRIORITY_LABELS = {
  low: 'Тихое',
  normal: '🤍 Хочу',
  high: '❤️ Очень хочу',
  dream: '✨ Мечта'
};

export const ITEM_STATUSES = ['active', 'reserved', 'purchased', 'done', 'archived'];

/**
 * Reservations live outside the list item so a future server can omit them
 * for the person who created the wish. The author must not see who reserved
 * it, or that it is reserved at all.
 */
export function visibleItemForRole(state, item, role) {
  if (!item) return null;
  const copy = {
    ...item,
    metadata: { ...(item.metadata || {}) }
  };
  delete copy.reservedBy;
  delete copy.metadata.reservedBy;
  if (copy.status === 'reserved' && copy.createdBy === role) {
    copy.status = 'active';
    copy.reservationHidden = true;
  }
  return copy;
}

export function reserveListItem(state, id, { actorRole, now = new Date().toISOString(), idFactory = createId } = {}) {
  const item = getListItem(state, id);
  if (!item) return { ok: false, reason: 'missing' };
  if (!actorRole || item.createdBy === actorRole) return { ok: false, reason: 'own_item' };
  if (item.status === 'purchased' || item.status === 'done' || item.status === 'archived') {
    return { ok: false, reason: 'closed' };
  }
  if (!Array.isArray(state.reservations)) state.reservations = [];
  item.status = 'reserved';
  delete item.reservedBy;
  state.reservations = state.reservations.filter((entry) => entry.itemId !== id);
  state.reservations.push({
    id: idFactory(),
    itemId: id,
    reservedBy: actorRole,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending',
    lastSyncedAt: null,
    version: 1
  });
  touch(item, now);
  return { ok: true, item: visibleItemForRole(state, item, actorRole) };
}

export function completeListItem(state, id, { actorRole = 'a', now = new Date().toISOString() } = {}) {
  const item = getListItem(state, id);
  if (!item) return null;
  const list = getList(state, item.listId);
  const wishlist = list?.type === 'wishlist';
  item.status = wishlist ? 'purchased' : 'done';
  delete item.reservedBy;
  state.reservations = (state.reservations || []).filter((entry) => entry.itemId !== id);
  touch(item, now);
  if (list) touch(list, now);
  recordEvent(
    state,
    wishlist ? DomainEventType.WishlistItemCompleted : DomainEventType.ListItemCompleted,
    { itemId: item.id, listId: item.listId, listType: list?.type || item.type },
    now
  );
  return {
    item: visibleItemForRole(state, item, actorRole),
    momentDraft: momentDraftFromItem(state, item)
  };
}

export function momentDraftFromItem(state, item) {
  const list = getList(state, item.listId);
  const typeByList = {
    wishlist: 'wish',
    places: 'outing',
    watch: 'watch',
    trips: 'trip',
    dates: 'date',
    home: 'home'
  };
  const locationName = item.metadata?.location?.name || (list?.type === 'places' || list?.type === 'trips' ? item.title : '');
  return {
    title: item.title,
    description: item.metadata?.note || item.description || '',
    date: todayIsoDate(),
    endDate: null,
    type: typeByList[list?.type] || 'memory',
    location: {
      name: locationName,
      latitude: item.metadata?.location?.latitude ?? null,
      longitude: item.metadata?.location?.longitude ?? null
    },
    coverImage: item.imageUrl || '',
    relatedListItems: [item.id],
    tags: [],
    relatedPeople: []
  };
}

export function applyProductMetadata(itemPatch, meta) {
  if (!meta) return itemPatch;
  return {
    ...itemPatch,
    title: itemPatch.title || meta.title || '',
    description: itemPatch.description || meta.description || '',
    url: meta.url || itemPatch.url || '',
    imageUrl: itemPatch.imageUrl || meta.imageUrl || '',
    metadata: {
      ...(itemPatch.metadata || {}),
      price: meta.price ?? itemPatch.metadata?.price ?? null,
      oldPrice: meta.oldPrice ?? itemPatch.metadata?.oldPrice ?? null,
      currency: meta.currency || itemPatch.metadata?.currency || 'RUB',
      store: meta.store || itemPatch.metadata?.store || '',
      storeDomain: meta.storeDomain || itemPatch.metadata?.storeDomain || '',
      source: meta.source || 'manual',
      note: itemPatch.metadata?.note || ''
    }
  };
}

export function normalizeWishPatch(input) {
  const priority = PRIORITIES.includes(input.priority) ? input.priority : 'normal';
  const status = ITEM_STATUSES.includes(input.status) ? input.status : 'active';
  return {
    title: input.title,
    description: input.description || '',
    url: input.url || '',
    imageUrl: input.imageUrl || '',
    priority,
    status,
    metadata: {
      price: numberOrNull(input.price ?? input.metadata?.price),
      oldPrice: numberOrNull(input.oldPrice ?? input.metadata?.oldPrice),
      currency: input.currency || input.metadata?.currency || 'RUB',
      store: input.store || input.metadata?.store || '',
      storeDomain: input.storeDomain || input.metadata?.storeDomain || '',
      note: input.note || input.metadata?.note || '',
      source: input.source || input.metadata?.source || 'manual',
      location: input.metadata?.location || null,
      plannedDate: input.metadata?.plannedDate || null
    }
  };
}

export function sortListItems(items) {
  const priorityRank = { dream: 0, high: 1, normal: 2, low: 3 };
  const statusRank = { active: 0, reserved: 0, done: 1, purchased: 1, archived: 2 };
  return [...items].sort((a, b) => {
    const status = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (status) return status;
    const priority = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
    if (priority) return priority;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

export function completionCopy(list, item) {
  const title = item?.title || 'это';
  if (list?.type === 'wishlist') {
    return {
      headline: 'Желание исполнилось!',
      body: 'Сохранить этот момент в вашей истории?',
      action: 'Сохранить момент'
    };
  }
  if (list?.type === 'trips') {
    return {
      headline: `Вы планировали поездку в ${title}.`,
      body: 'Создать воспоминание?',
      action: 'Создать момент'
    };
  }
  if (list?.type === 'places') {
    return {
      headline: 'Мы сходили ❤️',
      body: `${title} можно оставить в вашей истории.`,
      action: 'Создать момент'
    };
  }
  if (list?.type === 'watch') {
    return {
      headline: 'Посмотрели вместе',
      body: 'Сохранить этот вечер в истории?',
      action: 'Создать момент'
    };
  }
  return {
    headline: 'Сделано',
    body: 'Сохранить это в вашей истории?',
    action: 'Создать момент'
  };
}

export function formatMoney(amount, currency = 'RUB') {
  if (amount == null || amount === '' || Number.isNaN(Number(amount))) return '';
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency || 'RUB',
      maximumFractionDigits: 0
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency || ''}`.trim();
  }
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function todayIsoDate() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export { updateListItem };
