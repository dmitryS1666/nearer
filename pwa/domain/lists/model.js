import { createId } from '../ids.js';
import { newEntity, touch } from '../syncMeta.js';

export const LIST_TYPES = ['wishlist', 'places', 'watch', 'trips', 'dates', 'home', 'custom'];

export const DEFAULT_LISTS = [
  { name: 'Хотелки', icon: '🎁', type: 'wishlist', seedKey: 'wishlist' },
  { name: 'Куда сходить', icon: '🍴', type: 'places', seedKey: 'places' },
  { name: 'Посмотреть вместе', icon: '🎬', type: 'watch', seedKey: 'watch' },
  { name: 'Куда поехать', icon: '✈️', type: 'trips', seedKey: 'trips' },
  { name: 'Свидания', icon: '❤️', type: 'dates', seedKey: 'dates' },
  { name: 'Для дома', icon: '🏠', type: 'home', seedKey: 'home' }
];

export function seedDefaultLists(state, now, idFactory = createId) {
  if (!Array.isArray(state.lists)) state.lists = [];
  if (state.defaultListsSeeded) return state.lists;
  for (const def of DEFAULT_LISTS) {
    const exists = state.lists.some((list) => list.seedKey === def.seedKey || (list.type === def.type && list.type !== 'custom'));
    if (exists) continue;
    state.lists.push(makeList({ ...def, createdBy: 'a' }, now, idFactory));
  }
  state.defaultListsSeeded = true;
  return state.lists;
}

function makeList(input, now, idFactory) {
  return newEntity(
    {
      id: idFactory(),
      name: String(input.name || 'Список').trim().slice(0, 60),
      icon: input.icon || '✨',
      type: LIST_TYPES.includes(input.type) ? input.type : 'custom',
      seedKey: input.seedKey || null,
      createdBy: input.createdBy || 'a'
    },
    now
  );
}

export function getLists(state) {
  return [...(state.lists || [])];
}

export function getList(state, id) {
  return (state.lists || []).find((list) => list.id === id) || null;
}

export function createList(state, input, { now = new Date().toISOString(), idFactory = createId, actorRole = 'a' } = {}) {
  const name = String(input?.name || '').trim();
  if (!name) return null;
  if (!Array.isArray(state.lists)) state.lists = [];
  const list = makeList(
    {
      name,
      icon: input.icon || '✨',
      type: input.type || 'custom',
      createdBy: actorRole
    },
    now,
    idFactory
  );
  state.lists.push(list);
  return list;
}

export function updateList(state, id, patch, { now = new Date().toISOString() } = {}) {
  const list = getList(state, id);
  if (!list) return null;
  if (typeof patch.name === 'string' && patch.name.trim()) list.name = patch.name.trim().slice(0, 60);
  if (typeof patch.icon === 'string' && patch.icon.trim()) list.icon = patch.icon.trim().slice(0, 8);
  touch(list, now);
  return list;
}

export function deleteList(state, id) {
  const before = (state.lists || []).length;
  state.lists = (state.lists || []).filter((list) => list.id !== id);
  state.listItems = (state.listItems || []).filter((item) => item.listId !== id);
  state.reservations = (state.reservations || []).filter((entry) => {
    const item = (state.listItems || []).find((candidate) => candidate.id === entry.itemId);
    return Boolean(item);
  });
  return state.lists.length !== before;
}

export function getListItems(state, listId) {
  return (state.listItems || []).filter((item) => !listId || item.listId === listId);
}

export function getListItem(state, id) {
  return (state.listItems || []).find((item) => item.id === id) || null;
}

export function createListItem(state, input, { now = new Date().toISOString(), idFactory = createId, actorRole = 'a' } = {}) {
  const list = getList(state, input?.listId);
  const title = String(input?.title || '').trim();
  if (!list || !title) return null;
  if (!Array.isArray(state.listItems)) state.listItems = [];
  const item = newEntity(
    {
      id: idFactory(),
      listId: list.id,
      type: input.type || list.type,
      title: title.slice(0, 180),
      description: String(input.description || '').slice(0, 2000),
      url: String(input.url || '').slice(0, 2000),
      imageUrl: String(input.imageUrl || '').slice(0, 2000),
      status: input.status || 'active',
      priority: input.priority || 'normal',
      metadata: { ...(input.metadata || {}) },
      createdBy: actorRole
    },
    now
  );
  delete item.metadata.reservedBy;
  state.listItems.push(item);
  touch(list, now);
  return item;
}

export function updateListItem(state, id, patch, { now = new Date().toISOString(), actorRole = 'a' } = {}) {
  const item = getListItem(state, id);
  if (!item) return null;
  const next = { ...patch };
  delete next.id;
  delete next.listId;
  delete next.createdBy;
  delete next.createdAt;
  delete next.reservedBy;
  if (item.status === 'reserved' && actorRole === item.createdBy) delete next.status;
  if (next.metadata && typeof next.metadata === 'object') {
    item.metadata = { ...(item.metadata || {}), ...next.metadata };
    delete item.metadata.reservedBy;
    delete next.metadata;
  }
  if (typeof next.title === 'string') next.title = next.title.trim().slice(0, 180);
  if (typeof next.description === 'string') next.description = next.description.slice(0, 2000);
  Object.assign(item, next);
  if (!item.title) item.title = 'Без названия';
  touch(item, now);
  const list = getList(state, item.listId);
  if (list) touch(list, now);
  return item;
}

export function deleteListItem(state, id) {
  const before = (state.listItems || []).length;
  state.listItems = (state.listItems || []).filter((item) => item.id !== id);
  state.reservations = (state.reservations || []).filter((entry) => entry.itemId !== id);
  return state.listItems.length !== before;
}
