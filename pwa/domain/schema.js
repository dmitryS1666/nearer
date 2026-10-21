import { createId } from './ids.js';
import { normalizeDeviceLink } from './link.js';
import { seedDefaultLists } from './lists/model.js';
import { normalizeLocation } from './moments/model.js';
import { normalizePhotoStorage } from './media/model.js';

export const SCHEMA_VERSION = 2;

export function migrateState(state, { now = new Date().toISOString(), idFactory = createId } = {}) {
  state.lists ||= [];
  state.listItems ||= [];
  state.reservations ||= [];
  state.moments ||= [];
  state.mediaAttachments ||= [];
  state.importantDates ||= [];
  state.domainEvents ||= [];
  state.photoStorage = normalizePhotoStorage(state.photoStorage);
  state.deviceLink = normalizeDeviceLink(state.deviceLink);

  if (!state.circleId) state.circleId = idFactory();

  if (!state.startedUsingAt) {
    const earliest = (state.history || []).map((entry) => entry.calendarDate).filter(Boolean).sort()[0];
    state.startedUsingAt = earliest ? `${earliest}T12:00:00.000Z` : now;
  }

  for (const moment of state.moments) {
    if (typeof moment.favorite !== 'boolean') moment.favorite = false;
    moment.location = normalizeLocation(moment.location);
    moment.media ||= [];
    moment.tags ||= [];
    moment.relatedListItems ||= [];
    moment.relatedPeople ||= [];
  }

  for (const item of state.listItems) {
    item.metadata ||= {};
    delete item.reservedBy;
    delete item.metadata.reservedBy;
  }

  seedDefaultLists(state, now, idFactory);
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}
