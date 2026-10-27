import { createId } from './ids.js';
import { normalizeDeviceLink } from './link.js';
import { seedDefaultLists } from './lists/model.js';
import { normalizeLocation } from './moments/model.js';
import { normalizePhotoStorage } from './media/model.js';
import { GARDEN_CONTENT_VERSION } from './garden/themes.js';
import { normalizeActivePeriods } from './garden/period.js';
import {
  collectAffiliatedCircleIds,
  hasUserArchive,
  currentCircleId
} from './garden/ownership.js';
import { isFlatDayMap, nestAnswersMap, nestReactionsMap } from './garden/dayMaps.js';

/** Local IndexedDB schema. Bump when persisted shape changes. */
export const SCHEMA_VERSION = 6;

function ensureStatusMeta(period) {
  if (!period) return;
  if (!period.statusUpdatedAt) {
    period.statusUpdatedAt = period.updatedAt || period.createdAt || null;
  }
  if (period.statusVersion == null) {
    period.statusVersion = Number(period.version) || 1;
  }
}

export function migrateState(state, { now = new Date().toISOString(), idFactory = createId } = {}) {
  const fromVersion = Number(state.schemaVersion) || 0;
  state.lists ||= [];
  state.listItems ||= [];
  state.reservations ||= [];
  state.moments ||= [];
  state.mediaAttachments ||= [];
  state.importantDates ||= [];
  state.domainEvents ||= [];
  state.photoStorage = normalizePhotoStorage(state.photoStorage);
  state.deviceLink = normalizeDeviceLink(state.deviceLink);
  state.circleStats = state.circleStats && typeof state.circleStats === 'object' ? state.circleStats : {};

  if (!state.circleId) state.circleId = idFactory();

  // Nest daily maps (idempotent). Unscoped flat entries land in __orphan__ and stay there.
  if (isFlatDayMap(state.answers) || !state.answers) {
    state.answers = nestAnswersMap(state.answers || {});
  }
  if (isFlatDayMap(state.reactions) || !state.reactions) {
    state.reactions = nestReactionsMap(state.reactions || {});
  }

  // Recover lastBoundPairId when leave happened on an older client (schema ≤3).
  if (state.lastBoundPairId == null && state.deviceLink?.pairId) {
    state.lastBoundPairId = state.deviceLink.pairId;
  } else if (
    state.lastBoundPairId == null &&
    !state.deviceLink?.pairId &&
    fromVersion > 0 &&
    fromVersion <= 3
  ) {
    const affiliated = collectAffiliatedCircleIds(state);
    if (affiliated.size > 0) {
      state.lastBoundPairId =
        state.circleId && affiliated.has(state.circleId) ? state.circleId : [...affiliated][0];
    }
  }

  if (!state.activeCircleId) {
    state.activeCircleId = state.deviceLink?.pairId || state.lastBoundPairId || state.circleId;
  }

  // Proven solo marker: only brand-new empty installs. Never backfill onto legacy archives.
  if (
    state.soloCircleId == null &&
    !state.lastBoundPairId &&
    !state.deviceLink?.pairId &&
    !hasUserArchive(state)
  ) {
    state.soloCircleId = state.circleId;
  } else if (state.soloCircleId === undefined) {
    state.soloCircleId = null;
  }

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

  if (!Array.isArray(state.periods)) state.periods = [];
  for (const period of state.periods) {
    period.answers ||= {};
    period.challenge ||= {};
    ensureStatusMeta(period);
  }
  if (state.gardenContentVersion == null) state.gardenContentVersion = GARDEN_CONTENT_VERSION;

  // Never auto-stamp orphan/unscoped onto the live pair on migrate/load.
  const circle = currentCircleId(state) || state.circleId;
  normalizeActivePeriods(state, { now, circleId: circle });

  state.schemaVersion = SCHEMA_VERSION;
  return state;
}
