export const SYNC_KIND = 'blizhe-pair-sync';
export const SYNC_VERSION = 1;

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

/** Shared couple archive fields only — never device secrets or local-only prefs. */
export function buildSyncPayload(state, now = new Date().toISOString()) {
  return {
    kind: SYNC_KIND,
    version: SYNC_VERSION,
    exportedAt: now,
    circleId: state.circleId || null,
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
    answers: structuredClone(state.answers || {}),
    history: structuredClone(state.history || []),
    reactions: structuredClone(state.reactions || {}),
    lists: structuredClone(state.lists || []),
    listItems: structuredClone(state.listItems || []),
    reservations: structuredClone(state.reservations || []),
    moments: (state.moments || []).map(scrubMoment),
    mediaAttachments: (state.mediaAttachments || []).map(scrubMedia),
    importantDates: structuredClone(state.importantDates || []),
    domainEvents: structuredClone(state.domainEvents || [])
  };
}

export function isSyncPayload(payload) {
  return Boolean(payload && payload.kind === SYNC_KIND && payload.version === SYNC_VERSION && typeof payload === 'object');
}
