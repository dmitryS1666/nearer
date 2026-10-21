import { createId } from '../ids.js';
import { newEntity, touch } from '../syncMeta.js';
import { recordEvent, DomainEventType } from '../events/events.js';

export const MOMENT_TYPES = [
  { id: 'memory', icon: '❤️', label: 'Момент' },
  { id: 'trip', icon: '✈️', label: 'Поездка' },
  { id: 'celebration', icon: '🎂', label: 'Праздник' },
  { id: 'outing', icon: '🍴', label: 'Встреча' },
  { id: 'home', icon: '🏠', label: 'Дом' },
  { id: 'family', icon: '👶', label: 'Семья' },
  { id: 'wish', icon: '🎁', label: 'Желание' },
  { id: 'watch', icon: '🎬', label: 'Кино' },
  { id: 'date', icon: '❤️', label: 'Свидание' }
];

export function emptyLocation(name = '') {
  return { name: name || '', latitude: null, longitude: null };
}

export function normalizeLocation(location) {
  if (!location) return emptyLocation();
  if (typeof location === 'string') return emptyLocation(location);
  const latitude = numberOrNull(location.latitude);
  const longitude = numberOrNull(location.longitude);
  return {
    name: String(location.name || '').slice(0, 160),
    latitude,
    longitude
  };
}

export function getMoments(state) {
  return [...(state.moments || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export function getMoment(state, id) {
  return (state.moments || []).find((moment) => moment.id === id) || null;
}

export function createMoment(state, input, { now = new Date().toISOString(), idFactory = createId, actorRole = 'a' } = {}) {
  const title = String(input?.title || '').trim();
  if (!title) return null;
  if (!Array.isArray(state.moments)) state.moments = [];
  const moment = newEntity(
    {
      id: idFactory(),
      title: title.slice(0, 180),
      description: String(input.description || '').slice(0, 4000),
      date: input.date || todayIsoDate(),
      endDate: input.endDate || null,
      type: input.type || 'memory',
      location: normalizeLocation(input.location),
      coverImage: input.coverImage || '',
      media: [],
      relatedListItems: Array.isArray(input.relatedListItems) ? [...input.relatedListItems] : [],
      relatedPeople: asStringList(input.relatedPeople),
      tags: asStringList(input.tags),
      favorite: Boolean(input.favorite),
      createdBy: actorRole
    },
    now
  );
  state.moments.push(moment);
  recordEvent(state, DomainEventType.MomentCreated, { momentId: moment.id, type: moment.type }, now);
  return moment;
}

export function updateMoment(state, id, patch, { now = new Date().toISOString() } = {}) {
  const moment = getMoment(state, id);
  if (!moment) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) moment.title = patch.title.trim().slice(0, 180);
  if (typeof patch.description === 'string') moment.description = patch.description.slice(0, 4000);
  if (typeof patch.date === 'string' && patch.date) moment.date = patch.date;
  if ('endDate' in patch) moment.endDate = patch.endDate || null;
  if (typeof patch.type === 'string') moment.type = patch.type;
  if ('location' in patch) moment.location = normalizeLocation(patch.location);
  if (typeof patch.coverImage === 'string') moment.coverImage = patch.coverImage;
  if (Array.isArray(patch.relatedListItems)) moment.relatedListItems = [...patch.relatedListItems];
  if (Array.isArray(patch.relatedPeople) || typeof patch.relatedPeople === 'string') {
    moment.relatedPeople = asStringList(patch.relatedPeople);
  }
  if (Array.isArray(patch.tags) || typeof patch.tags === 'string') moment.tags = asStringList(patch.tags);
  if (typeof patch.favorite === 'boolean') moment.favorite = patch.favorite;
  touch(moment, now);
  return moment;
}

export function deleteMoment(state, id) {
  const before = (state.moments || []).length;
  state.moments = (state.moments || []).filter((moment) => moment.id !== id);
  state.mediaAttachments = (state.mediaAttachments || []).filter((media) => media.momentId !== id);
  return state.moments.length !== before;
}

export function setMomentFavorite(state, id, favorite, now = new Date().toISOString()) {
  return updateMoment(state, id, { favorite: Boolean(favorite) }, { now });
}

export function momentTypeMeta(type) {
  return MOMENT_TYPES.find((item) => item.id === type) || MOMENT_TYPES[0];
}

function asStringList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return source.map((item) => String(item).trim()).filter(Boolean).slice(0, 24);
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function todayIsoDate() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
