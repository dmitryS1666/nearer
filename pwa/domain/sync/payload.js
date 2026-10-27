import { periodPayloadList } from '../garden/mergePeriods.js';
import {
  currentCircleId,
  entitiesForCircle,
  filterAnswersForCircle,
  filterHistoryForCircle,
  filterReactionsForCircle
} from '../garden/ownership.js';

export const SYNC_KIND = 'blizhe-pair-sync';
/** Wire/protocol version for encrypted payload body. */
export const SYNC_VERSION = 3;
/** Declared to the server so older clients cannot overwrite newer ciphertext. */
export const SYNC_FORMAT_VERSION = 3;

const DATA_URL_RE = /^data:/i;
const MAX_INLINE_URL = 8_192;

function scrubUrl(value) {
  if (typeof value !== 'string') return '';
  if (DATA_URL_RE.test(value) || value.length > MAX_INLINE_URL) return '';
  return value;
}

function scrubMedia(media) {
  if (!media || typeof media !== 'object') return media;
  const next = { ...media, metadata: { ...(media.metadata || {}) } };
  next.sourceUrl = scrubUrl(next.sourceUrl);
  next.previewUrl = scrubUrl(next.previewUrl);
  if (next.metadata) {
    for (const key of Object.keys(next.metadata)) {
      if (typeof next.metadata[key] === 'string') next.metadata[key] = scrubUrl(next.metadata[key]);
    }
  }
  return next;
}

function scrubMoment(moment) {
  if (!moment || typeof moment !== 'object') return moment;
  return {
    ...moment,
    coverImage: scrubUrl(moment.coverImage),
    media: Array.isArray(moment.media) ? [...moment.media] : []
  };
}

/**
 * Drop media/moment cross-references that point outside the current circle.
 */
function isolateRelated(moments, mediaAttachments, circleId) {
  const mediaIds = new Set((mediaAttachments || []).map((m) => m.id));
  return (moments || []).map((moment) => {
    const next = scrubMoment(moment);
    if (Array.isArray(next.media)) {
      next.media = next.media.filter((id) => mediaIds.has(id));
    }
    if (Array.isArray(next.relatedListItems)) {
      // list item ids may be foreign — filtered listItems already scoped; drop orphans later if needed
    }
    return { ...next, circleId: next.circleId || circleId };
  });
}

/**
 * Shared couple archive for the **current** circle only.
 * Unscoped / foreign entities stay local and are never auto-sent.
 */
export function buildSyncPayload(state, now = new Date().toISOString()) {
  const circleId = currentCircleId(state) || state.circleId || null;
  const lists = entitiesForCircle(state.lists, circleId);
  const listIds = new Set(lists.map((l) => l.id));
  const listItems = entitiesForCircle(state.listItems, circleId).filter(
    (item) => !item.listId || listIds.has(item.listId)
  );
  const mediaAttachments = entitiesForCircle(state.mediaAttachments, circleId).map(scrubMedia);
  const moments = isolateRelated(entitiesForCircle(state.moments, circleId), mediaAttachments, circleId);
  const itemIds = new Set(listItems.map((i) => i.id));
  const reservations = entitiesForCircle(state.reservations, circleId).filter(
    (r) => !r.itemId || itemIds.has(r.itemId)
  );

  return {
    kind: SYNC_KIND,
    version: SYNC_VERSION,
    formatVersion: SYNC_FORMAT_VERSION,
    minClientSyncVersion: SYNC_FORMAT_VERSION,
    exportedAt: now,
    circleId,
    startedUsingAt: state.startedUsingAt || null,
    defaultListsSeeded: Boolean(state.defaultListsSeeded),
    profile: {
      name: state.profile?.name || 'Ты',
      partnerName: state.profile?.partnerName || 'Партнёр'
    },
    calendarDate: state.calendarDate || null,
    questionId: state.questionId || null,
    dayIndex: state.dayIndex || 0,
    streak: state.streak || 0,
    completedDays: state.completedDays || 0,
    lastCompletedCalendarDate: state.lastCompletedCalendarDate || null,
    answers: filterAnswersForCircle(state.answers, circleId),
    history: filterHistoryForCircle(state.history, circleId),
    reactions: filterReactionsForCircle(state.reactions, circleId),
    lists: structuredClone(lists),
    listItems: structuredClone(listItems),
    reservations: structuredClone(reservations),
    moments,
    mediaAttachments,
    importantDates: structuredClone(entitiesForCircle(state.importantDates, circleId)),
    domainEvents: structuredClone(entitiesForCircle(state.domainEvents, circleId)),
    periods: periodPayloadList(state.periods || [], circleId),
    gardenContentVersion: state.gardenContentVersion || null
  };
}

export function isSyncPayload(payload) {
  return Boolean(
    payload &&
      payload.kind === SYNC_KIND &&
      (payload.version === 1 || payload.version === 2 || payload.version === 3) &&
      typeof payload === 'object'
  );
}

/** True when decrypted remote snapshot needs a newer app. */
export function payloadRequiresUpgrade(payload, clientFormat = SYNC_FORMAT_VERSION) {
  const need = Number(payload?.minClientSyncVersion || payload?.formatVersion || payload?.version || 1);
  return need > clientFormat;
}
