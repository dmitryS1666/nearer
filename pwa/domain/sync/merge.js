import { isSyncPayload } from './payload.js';

function stamp(entity) {
  const updated = Date.parse(entity?.updatedAt || entity?.createdAt || 0) || 0;
  const version = Number(entity?.version) || 0;
  return updated * 1000 + version;
}

function mergeById(localList = [], remoteList = []) {
  const map = new Map();
  for (const item of localList) {
    if (item?.id) map.set(item.id, item);
  }
  for (const item of remoteList) {
    if (!item?.id) continue;
    const prev = map.get(item.id);
    if (!prev || stamp(item) >= stamp(prev)) map.set(item.id, item);
  }
  return [...map.values()];
}

function answerStamp(entry) {
  return Date.parse(entry?.submittedAt || entry?.at || entry?.updatedAt || 0) || 0;
}

function mergeAnswerRoles(local = {}, remote = {}) {
  const dayOut = { ...local };
  for (const role of ['a', 'b']) {
    const left = local[role];
    const right = remote[role];
    if (!left) dayOut[role] = right;
    else if (!right) dayOut[role] = left;
    else dayOut[role] = answerStamp(right) >= answerStamp(left) ? right : left;
  }
  return dayOut;
}

function mergeAnswers(local = {}, remote = {}) {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const out = {};
  for (const day of keys) {
    out[day] = mergeAnswerRoles(local[day] || {}, remote[day] || {});
  }
  return out;
}

function mergeHistory(local = [], remote = []) {
  const map = new Map();
  for (const entry of [...local, ...remote]) {
    if (!entry?.calendarDate) continue;
    const prev = map.get(entry.calendarDate);
    if (!prev) {
      map.set(entry.calendarDate, entry);
      continue;
    }
    map.set(entry.calendarDate, {
      ...prev,
      ...entry,
      answers: mergeAnswerRoles(prev.answers || {}, entry.answers || {}),
      question: entry.question || prev.question
    });
  }
  return [...map.values()].sort((a, b) => String(a.calendarDate).localeCompare(String(b.calendarDate)));
}

function mergeReactions(local = {}, remote = {}) {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const out = {};
  for (const key of keys) {
    const left = local[key];
    const right = remote[key];
    if (!left) out[key] = right;
    else if (!right) out[key] = left;
    else out[key] = answerStamp(right) >= answerStamp(left) ? right : left;
  }
  return out;
}

/**
 * Apply a decrypted remote snapshot onto local state.
 * Device secrets, role, notifications, and test lab stay local.
 */
export function mergeSyncPayload(localState, remotePayload) {
  if (!isSyncPayload(remotePayload)) {
    const error = new Error('invalid_sync_payload');
    error.code = 'invalid_sync_payload';
    throw error;
  }
  const next = structuredClone(localState);
  next.circleId = next.circleId || remotePayload.circleId || next.circleId;
  next.startedUsingAt = [next.startedUsingAt, remotePayload.startedUsingAt].filter(Boolean).sort()[0] || next.startedUsingAt;
  next.defaultListsSeeded = Boolean(next.defaultListsSeeded || remotePayload.defaultListsSeeded);

  if (remotePayload.profile) {
    // Keep "my" display name for currentRole; adopt partner label from peer profile when empty-ish.
    if (next.currentRole === 'a') {
      next.profile.partnerName = remotePayload.profile.name || next.profile.partnerName;
    } else {
      next.profile.partnerName = remotePayload.profile.name || next.profile.partnerName;
    }
  }

  next.answers = mergeAnswers(next.answers, remotePayload.answers);
  next.history = mergeHistory(next.history, remotePayload.history);
  next.reactions = mergeReactions(next.reactions, remotePayload.reactions);
  next.lists = mergeById(next.lists, remotePayload.lists);
  next.listItems = mergeById(next.listItems, remotePayload.listItems);
  next.reservations = mergeById(next.reservations, remotePayload.reservations);
  next.moments = mergeById(next.moments, remotePayload.moments);
  next.mediaAttachments = mergeById(next.mediaAttachments, remotePayload.mediaAttachments);
  next.importantDates = mergeById(next.importantDates, remotePayload.importantDates);
  next.domainEvents = mergeById(next.domainEvents, remotePayload.domainEvents);

  next.completedDays = Math.max(Number(next.completedDays) || 0, Number(remotePayload.completedDays) || 0);
  next.streak = Math.max(Number(next.streak) || 0, Number(remotePayload.streak) || 0);
  const localDone = next.lastCompletedCalendarDate || '';
  const remoteDone = remotePayload.lastCompletedCalendarDate || '';
  if (remoteDone > localDone) next.lastCompletedCalendarDate = remoteDone;

  // Shared ritual day: prefer the newer calendar day assignment.
  if (remotePayload.calendarDate && (!next.calendarDate || remotePayload.calendarDate > next.calendarDate)) {
    next.calendarDate = remotePayload.calendarDate;
    next.questionId = remotePayload.questionId || next.questionId;
    next.dayIndex = remotePayload.dayIndex ?? next.dayIndex;
  } else if (remotePayload.calendarDate === next.calendarDate && remotePayload.questionId) {
    next.questionId = next.questionId || remotePayload.questionId;
  }

  return next;
}
