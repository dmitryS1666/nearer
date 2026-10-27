/**
 * Circle-scoped daily answers & reactions.
 * Local shape (schema ≥ 5):
 *   answers[circleId][YYYY-MM-DD] = { a?, b? }
 *   reactions[circleId][YYYY-MM-DD] = { value, updatedAt? } | string
 * Wire/sync payload still uses flat date keys for the active circle only.
 */

export const ORPHAN_CIRCLE = '__orphan__';
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isFlatDayMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  return Object.keys(map).some((key) => DATE_RE.test(key));
}

function mergeRoleSlots(left = {}, right = {}) {
  const out = { ...left, ...right };
  for (const role of ['a', 'b']) {
    const L = left[role];
    const R = right[role];
    if (!L) out[role] = R;
    else if (!R) out[role] = L;
    else {
      const lt = Date.parse(L.submittedAt || L.at || L.updatedAt || 0) || 0;
      const rt = Date.parse(R.submittedAt || R.at || R.updatedAt || 0) || 0;
      out[role] = rt >= lt ? R : L;
    }
  }
  return out;
}

/** Convert legacy flat date→entry maps into nested circle→date maps. Idempotent. */
export function nestAnswersMap(map) {
  if (!map || typeof map !== 'object') return {};
  if (!isFlatDayMap(map)) return { ...map };
  const out = {};
  for (const [day, entry] of Object.entries(map)) {
    if (!DATE_RE.test(day)) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        out[day] = { ...(out[day] || {}), ...entry };
      }
      continue;
    }
    let circle = ORPHAN_CIRCLE;
    let dayEntry = entry;
    if (entry && typeof entry === 'object') {
      if (typeof entry.circleId === 'string' && entry.circleId) {
        circle = entry.circleId;
        dayEntry = { ...entry };
        delete dayEntry.circleId;
      }
    } else {
      continue;
    }
    out[circle] = out[circle] || {};
    out[circle][day] = mergeRoleSlots(out[circle][day], dayEntry);
  }
  return out;
}

export function nestReactionsMap(map) {
  if (!map || typeof map !== 'object') return {};
  if (!isFlatDayMap(map)) return { ...map };
  const out = {};
  for (const [day, entry] of Object.entries(map)) {
    if (!DATE_RE.test(day)) {
      if (entry && typeof entry === 'object') out[day] = { ...(out[day] || {}), ...entry };
      continue;
    }
    let circle = ORPHAN_CIRCLE;
    let value = entry;
    if (typeof entry === 'string') {
      value = { value: entry };
    } else if (entry && typeof entry === 'object') {
      if (typeof entry.circleId === 'string' && entry.circleId) {
        circle = entry.circleId;
        value = { ...entry };
        delete value.circleId;
      }
    } else continue;
    out[circle] = out[circle] || {};
    out[circle][day] = value;
  }
  return out;
}

/** Flat date→entry for one circle (sync wire / UI helpers). */
export function flattenCircleAnswers(answers, circleId) {
  const out = {};
  if (!circleId) return out;
  const bucket = answers?.[circleId] || {};
  for (const [day, entry] of Object.entries(bucket)) {
    if (!entry || typeof entry !== 'object') continue;
    out[day] = { ...structuredClone(entry), circleId };
  }
  return out;
}

export function flattenCircleReactions(reactions, circleId) {
  const out = {};
  if (!circleId) return out;
  const bucket = reactions?.[circleId] || {};
  for (const [day, entry] of Object.entries(bucket)) {
    if (typeof entry === 'string') out[day] = { circleId, value: entry };
    else if (entry && typeof entry === 'object') out[day] = { ...structuredClone(entry), circleId };
  }
  return out;
}

export function getDayAnswers(state, date, circleId) {
  const c = circleId || state?.activeCircleId || state?.circleId || null;
  if (!c || !date) return {};
  const answers = isFlatDayMap(state?.answers) ? nestAnswersMap(state.answers) : state?.answers || {};
  return { ...(answers[c]?.[date] || {}) };
}

export function setDayAnswer(state, date, role, answer, circleId) {
  const c = circleId || state?.activeCircleId || state?.circleId || null;
  if (!c || !date || (role !== 'a' && role !== 'b')) return state;
  if (isFlatDayMap(state.answers)) state.answers = nestAnswersMap(state.answers);
  state.answers = state.answers || {};
  state.answers[c] = state.answers[c] || {};
  const prev = state.answers[c][date] || {};
  state.answers[c][date] = { ...prev, [role]: answer };
  return state;
}

export function getDayReaction(state, date, circleId) {
  const c = circleId || state?.activeCircleId || state?.circleId || null;
  if (!c || !date) return null;
  const reactions = isFlatDayMap(state?.reactions) ? nestReactionsMap(state.reactions) : state?.reactions || {};
  return reactions[c]?.[date] ?? null;
}

export function setDayReaction(state, date, reaction, circleId) {
  const c = circleId || state?.activeCircleId || state?.circleId || null;
  if (!c || !date) return state;
  if (isFlatDayMap(state.reactions)) state.reactions = nestReactionsMap(state.reactions);
  state.reactions = state.reactions || {};
  state.reactions[c] = state.reactions[c] || {};
  state.reactions[c][date] =
    typeof reaction === 'string' ? { value: reaction, updatedAt: new Date().toISOString() } : reaction;
  return state;
}

/**
 * Remap one circle bucket onto another. Does NOT pull __orphan__ unless fromCircle is orphan
 * (callers must not pass ORPHAN for automatic pair adoption).
 */
export function remapNestedDayMap(map, fromCircle, toCircle) {
  if (!map || !toCircle || !fromCircle || fromCircle === toCircle) return map;
  if (isFlatDayMap(map)) map = nestAnswersMap(map);
  const next = { ...map };
  if (!next[fromCircle]) return next;
  next[toCircle] = next[toCircle] || {};
  for (const [day, entry] of Object.entries(next[fromCircle])) {
    next[toCircle][day] = mergeRoleSlots(next[toCircle][day], entry);
  }
  delete next[fromCircle];
  return next;
}
