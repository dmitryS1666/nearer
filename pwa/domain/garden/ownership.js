/**
 * Pair archive ownership — single policy for affiliation.
 *
 * Model: every shared entity carries `circleId`.
 * Daily answers/reactions are nested: answers[circleId][date].
 * - `activeCircleId`: which archive the UI/sync currently operate on.
 * - `lastBoundPairId`: last server pairId successfully bound (survives leave).
 * - `soloCircleId`: proven local solo space created on this install (never inferred for legacy).
 *
 * Operations (kept separate):
 * 1) New records → stamp with currentCircleId at creation time.
 * 2) Proven solo transfer → remapCircle(soloCircleId → pairId) on first bind only.
 * 3) Unknown legacy / __orphan__ / unscoped → stay local forever; never auto-sync or auto-adopt.
 */

import {
  ORPHAN_CIRCLE,
  DATE_RE,
  isFlatDayMap,
  nestAnswersMap,
  nestReactionsMap,
  flattenCircleAnswers,
  flattenCircleReactions,
  getDayAnswers,
  setDayAnswer,
  getDayReaction,
  setDayReaction,
  remapNestedDayMap
} from './dayMaps.js';

export const OWNED_LIST_KEYS = [
  'lists',
  'listItems',
  'reservations',
  'moments',
  'mediaAttachments',
  'importantDates',
  'domainEvents',
  'periods'
];

const CIRCLE_STAT_KEYS = [
  'streak',
  'completedDays',
  'lastCompletedCalendarDate',
  'calendarDate',
  'questionId',
  'dayIndex',
  'startedUsingAt',
  'defaultListsSeeded'
];

export {
  ORPHAN_CIRCLE,
  getDayAnswers,
  setDayAnswer,
  getDayReaction,
  setDayReaction,
  nestAnswersMap,
  nestReactionsMap
};

export function currentCircleId(state) {
  return state?.activeCircleId || state?.circleId || null;
}

export function expectedSyncCircleId(state) {
  return state?.deviceLink?.pairId || state?.activeCircleId || null;
}

export function entityBelongsToCircle(entity, circleId) {
  if (!circleId) return false;
  if (!entity || typeof entity !== 'object') return false;
  return entity.circleId === circleId;
}

export function entitiesForCircle(list, circleId) {
  if (!circleId) return [];
  return (list || []).filter((item) => entityBelongsToCircle(item, circleId));
}

/** Stamp a newly created entity with a known circle. Does not touch other records. */
export function stampEntity(entity, circleId) {
  if (!entity || typeof entity !== 'object' || !circleId) return entity;
  if (!entity.circleId) entity.circleId = circleId;
  return entity;
}

export function dayEntryCircleId(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return typeof entry.circleId === 'string' ? entry.circleId : null;
}

export function filterAnswersForCircle(answers, circleId) {
  if (!circleId) return {};
  if (isFlatDayMap(answers)) {
    const nested = nestAnswersMap(answers);
    return flattenCircleAnswers(nested, circleId);
  }
  return flattenCircleAnswers(answers, circleId);
}

export function filterReactionsForCircle(reactions, circleId) {
  if (!circleId) return {};
  if (isFlatDayMap(reactions)) {
    return flattenCircleReactions(nestReactionsMap(reactions), circleId);
  }
  return flattenCircleReactions(reactions, circleId);
}

export function filterHistoryForCircle(history, circleId) {
  return (history || []).filter((h) => h && h.circleId === circleId).map((h) => structuredClone(h));
}

/** Circle ids that already prove archive affiliation (excludes orphan). */
export function collectAffiliatedCircleIds(state) {
  const ids = new Set();
  for (const key of OWNED_LIST_KEYS) {
    for (const item of state?.[key] || []) {
      if (item?.circleId) ids.add(item.circleId);
    }
  }
  for (const entry of state?.history || []) {
    if (entry?.circleId) ids.add(entry.circleId);
  }
  const answers = isFlatDayMap(state?.answers) ? nestAnswersMap(state.answers) : state?.answers || {};
  for (const c of Object.keys(answers)) {
    if (c && c !== ORPHAN_CIRCLE && !DATE_RE.test(c)) ids.add(c);
  }
  const reactions = isFlatDayMap(state?.reactions) ? nestReactionsMap(state.reactions) : state?.reactions || {};
  for (const c of Object.keys(reactions)) {
    if (c && c !== ORPHAN_CIRCLE && !DATE_RE.test(c)) ids.add(c);
  }
  return ids;
}

/** True when state already holds user archive content (legacy or local). */
export function hasUserArchive(state) {
  if (!state) return false;
  if ((state.history || []).length) return true;
  if ((state.periods || []).length) return true;
  if ((state.moments || []).length) return true;
  if ((state.mediaAttachments || []).length) return true;
  if ((state.importantDates || []).length) return true;
  if ((state.domainEvents || []).length) return true;
  if ((state.reservations || []).length) return true;
  if ((state.listItems || []).length) return true;
  if ((state.lists || []).length) return true;
  const answers = state.answers || {};
  if (isFlatDayMap(answers) && Object.keys(answers).length) return true;
  for (const bucket of Object.values(answers)) {
    if (bucket && typeof bucket === 'object' && Object.keys(bucket).length) return true;
  }
  const reactions = state.reactions || {};
  if (isFlatDayMap(reactions) && Object.keys(reactions).length) return true;
  for (const bucket of Object.values(reactions)) {
    if (bucket && typeof bucket === 'object' && Object.keys(bucket).length) return true;
  }
  return false;
}

/**
 * @deprecated Do not use for pair bind / migrate. Unknown/unscoped must stay local.
 * Kept as a no-op so accidental callers cannot adopt __orphan__.
 */
export function stampUnscopedArchive(state, _circleId) {
  return state;
}

/**
 * Remap one known circle onto another. Never touches __orphan__ or unscoped entities.
 */
export function remapCircle(state, fromCircle, toCircle) {
  if (!state || !toCircle || !fromCircle || fromCircle === toCircle) return state;
  if (fromCircle === ORPHAN_CIRCLE) return state;

  for (const key of OWNED_LIST_KEYS) {
    for (const item of state[key] || []) {
      if (!item) continue;
      if (item.circleId === fromCircle) item.circleId = toCircle;
    }
  }
  for (const entry of state.history || []) {
    if (!entry) continue;
    if (entry.circleId === fromCircle) entry.circleId = toCircle;
  }
  if (isFlatDayMap(state.answers)) state.answers = nestAnswersMap(state.answers);
  if (isFlatDayMap(state.reactions)) state.reactions = nestReactionsMap(state.reactions);
  state.answers = remapNestedDayMap(state.answers || {}, fromCircle, toCircle);
  state.reactions = remapNestedDayMap(state.reactions || {}, fromCircle, toCircle);
  if (state.circleStats?.[fromCircle] && !state.circleStats[toCircle]) {
    state.circleStats[toCircle] = state.circleStats[fromCircle];
  }
  return state;
}

export function parkCircleStats(state, circleId) {
  if (!state || !circleId) return state;
  state.circleStats = state.circleStats || {};
  const snap = {};
  for (const key of CIRCLE_STAT_KEYS) {
    snap[key] = state[key];
  }
  state.circleStats[circleId] = snap;
  return state;
}

export function restoreCircleStats(state, circleId) {
  if (!state || !circleId) return state;
  const snap = state.circleStats?.[circleId];
  if (snap) {
    for (const key of CIRCLE_STAT_KEYS) {
      if (key in snap) state[key] = snap[key];
    }
  } else {
    state.streak = 0;
    state.completedDays = 0;
    state.lastCompletedCalendarDate = null;
    state.calendarDate = null;
    state.questionId = null;
    state.dayIndex = 0;
    state.defaultListsSeeded = Boolean(
      (state.lists || []).some((l) => l.circleId === circleId && l.seedKey)
    );
  }
  return state;
}

/**
 * Bind app state to a server pair.
 * - Switching pairs: never remap archives.
 * - First bind: transfer only proven soloCircleId (explicit marker), never orphan/unscoped.
 */
export function bindStateToPair(state, pairId, { previousPairId = null } = {}) {
  if (!state || !pairId) return state;
  if (isFlatDayMap(state.answers)) state.answers = nestAnswersMap(state.answers);
  if (isFlatDayMap(state.reactions)) state.reactions = nestReactionsMap(state.reactions);

  const lastBound = state.lastBoundPairId || previousPairId || null;
  const switchingPairs = Boolean(lastBound && lastBound !== pairId);
  const priorCircle = state.activeCircleId || state.circleId || null;

  if (switchingPairs && priorCircle && priorCircle !== pairId) {
    parkCircleStats(state, priorCircle);
  }

  state.activeCircleId = pairId;
  state.circleId = pairId;
  state.lastBoundPairId = pairId;

  if (switchingPairs) {
    restoreCircleStats(state, pairId);
    return state;
  }

  // Proven solo transfer only — never adopt __orphan__ / unscoped legacy.
  const solo = state.soloCircleId || null;
  if (solo && solo !== pairId && solo !== ORPHAN_CIRCLE) {
    remapCircle(state, solo, pairId);
  }
  state.soloCircleId = null;
  return state;
}

/** Call before clearing deviceLink on leave. */
export function rememberBoundPairOnLeave(state) {
  if (!state) return state;
  const pairId = state.deviceLink?.pairId || state.lastBoundPairId || state.activeCircleId || null;
  if (pairId) {
    state.lastBoundPairId = pairId;
    parkCircleStats(state, pairId);
    if (!state.activeCircleId) state.activeCircleId = pairId;
    if (!state.circleId) state.circleId = pairId;
  }
  return state;
}

function belongsToAccepted(entityCircleId, circleId, accepted) {
  if (!entityCircleId) return false;
  if (entityCircleId === circleId) return true;
  if (accepted && accepted.has(entityCircleId)) return true;
  return false;
}

export function mergeOwnedList(localList, remoteList, circleId, accepted = null) {
  const accept = accepted || new Set([circleId].filter(Boolean));
  // Unscoped + foreign stay local; never absorb into the live pair.
  const foreign = (localList || []).filter(
    (item) => item && (!item.circleId || !belongsToAccepted(item.circleId, circleId, accept))
  );
  const localOwned = (localList || []).filter(
    (item) => item?.circleId && belongsToAccepted(item.circleId, circleId, accept)
  );
  const map = new Map();
  for (const item of localOwned) {
    if (item?.id) map.set(item.id, { ...item, circleId: circleId || item.circleId });
  }
  for (const item of remoteList || []) {
    if (!item?.id) continue;
    if (!item.circleId || !belongsToAccepted(item.circleId, circleId, accept)) continue;
    const stamped = { ...item, circleId: circleId || item.circleId || null };
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, stamped);
      continue;
    }
    const pt = Date.parse(prev.updatedAt || 0) || 0;
    const rt = Date.parse(stamped.updatedAt || 0) || 0;
    const pv = Number(prev.version) || 0;
    const rv = Number(stamped.version) || 0;
    if (rt > pt || (rt === pt && rv >= pv)) map.set(item.id, { ...prev, ...stamped, circleId });
  }
  return [...foreign, ...map.values()];
}

/**
 * Merge remote flat (wire) answers into nested local answers for one circle.
 * Does not touch __orphan__ or other local circles.
 */
export function mergeAnswersForCircle(localAnswers, remoteAnswers, circleId, accepted = null) {
  const accept = accepted || new Set([circleId].filter(Boolean));
  let local = isFlatDayMap(localAnswers) ? nestAnswersMap(localAnswers) : { ...(localAnswers || {}) };

  let remoteFlat = {};
  if (isFlatDayMap(remoteAnswers)) {
    for (const [day, entry] of Object.entries(remoteAnswers || {})) {
      if (!entry || typeof entry !== 'object') continue;
      // Wire entries may omit circleId; they belong to the payload circle being merged.
      if (entry.circleId && !belongsToAccepted(entry.circleId, circleId, accept)) continue;
      remoteFlat[day] = entry;
    }
  } else if (remoteAnswers?.[circleId]) {
    remoteFlat = remoteAnswers[circleId];
  }

  local[circleId] = local[circleId] || {};
  const keys = new Set([...Object.keys(local[circleId]), ...Object.keys(remoteFlat)]);
  for (const day of keys) {
    const L = local[circleId][day] || {};
    const R = remoteFlat[day] || {};
    const merged = { ...L };
    for (const role of ['a', 'b']) {
      const left = L[role];
      const right = R[role];
      if (!left) merged[role] = right;
      else if (!right) merged[role] = left;
      else {
        const lt = Date.parse(left.submittedAt || left.at || left.updatedAt || 0) || 0;
        const rt = Date.parse(right.submittedAt || right.at || right.updatedAt || 0) || 0;
        merged[role] = rt >= lt ? right : left;
      }
    }
    local[circleId][day] = merged;
  }
  return local;
}

export function mergeHistoryForCircle(localHistory, remoteHistory, circleId, accepted = null) {
  const accept = accepted || new Set([circleId].filter(Boolean));
  const foreign = (localHistory || []).filter(
    (h) => !h?.circleId || !belongsToAccepted(h.circleId, circleId, accept)
  );
  const map = new Map();
  for (const entry of [...(localHistory || []), ...(remoteHistory || [])]) {
    if (!entry?.calendarDate) continue;
    if (!entry.circleId || !belongsToAccepted(entry.circleId, circleId, accept)) continue;
    const key = `${circleId}:${entry.calendarDate}`;
    const prev = map.get(key);
    const stamped = { ...entry, circleId: circleId || entry.circleId };
    if (!prev) {
      map.set(key, stamped);
      continue;
    }
    map.set(key, {
      ...prev,
      ...stamped,
      answers: { ...(prev.answers || {}), ...(stamped.answers || {}) },
      question: stamped.question || prev.question,
      circleId
    });
  }
  return [...foreign, ...map.values()].sort((a, b) =>
    String(a.calendarDate).localeCompare(String(b.calendarDate))
  );
}

export function mergeReactionsForCircle(localReactions, remoteReactions, circleId, accepted = null) {
  const accept = accepted || new Set([circleId].filter(Boolean));
  let local = isFlatDayMap(localReactions) ? nestReactionsMap(localReactions) : { ...(localReactions || {}) };

  let remoteFlat = {};
  if (isFlatDayMap(remoteReactions)) {
    for (const [day, entry] of Object.entries(remoteReactions || {})) {
      if (entry && typeof entry === 'object' && entry.circleId && !belongsToAccepted(entry.circleId, circleId, accept)) {
        continue;
      }
      remoteFlat[day] = entry;
    }
  } else if (remoteReactions?.[circleId]) {
    remoteFlat = remoteReactions[circleId];
  }

  local[circleId] = local[circleId] || {};
  const keys = new Set([...Object.keys(local[circleId] || {}), ...Object.keys(remoteFlat)]);
  for (const day of keys) {
    const left = local[circleId][day];
    const right = remoteFlat[day];
    const leftOk =
      left && typeof left === 'object'
        ? left
        : typeof left === 'string'
          ? { value: left }
          : null;
    let rightOk = null;
    if (right && typeof right === 'object') rightOk = { ...right };
    else if (typeof right === 'string') rightOk = { value: right };
    if (!leftOk && !rightOk) continue;
    if (!leftOk) local[circleId][day] = rightOk;
    else if (!rightOk) local[circleId][day] = leftOk;
    else {
      const lt = Date.parse(leftOk.updatedAt || leftOk.at || 0) || 0;
      const rt = Date.parse(rightOk.updatedAt || rightOk.at || 0) || 0;
      local[circleId][day] = rt >= lt ? rightOk : leftOk;
    }
  }
  return local;
}

export function reactionValue(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return entry.value || entry.emoji || null;
  return null;
}
