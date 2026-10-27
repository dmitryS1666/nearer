import { isSyncPayload, payloadRequiresUpgrade, SYNC_FORMAT_VERSION } from './payload.js';
import { mergePeriods } from '../garden/mergePeriods.js';
import {
  expectedSyncCircleId,
  mergeOwnedList,
  mergeAnswersForCircle,
  mergeHistoryForCircle,
  mergeReactionsForCircle,
  remapCircle
} from '../garden/ownership.js';
import { isFlatDayMap, nestAnswersMap, nestReactionsMap } from '../garden/dayMaps.js';

function circleMismatchError() {
  const error = new Error('sync_circle_mismatch');
  error.code = 'sync_circle_mismatch';
  return error;
}

/**
 * Apply a decrypted remote snapshot onto local state.
 * Device secrets, role, notifications, and test lab stay local.
 * Inbound circleId must match the expected bound pair before any mutation.
 */
export function mergeSyncPayload(localState, remotePayload, { now = new Date().toISOString() } = {}) {
  if (!isSyncPayload(remotePayload)) {
    const error = new Error('invalid_sync_payload');
    error.code = 'invalid_sync_payload';
    throw error;
  }
  if (payloadRequiresUpgrade(remotePayload, SYNC_FORMAT_VERSION)) {
    const error = new Error('client_outdated');
    error.code = 'client_outdated';
    throw error;
  }

  const remoteCircle = remotePayload.circleId || null;
  const pairId = localState.deviceLink?.pairId || null;
  const remoteVersion = Number(remotePayload.version || remotePayload.formatVersion || 1);

  // Linked devices: never trust a payload claiming a different circle.
  // Modern protocol (v3+): missing circleId is also a hard failure.
  if (pairId) {
    if (remoteVersion >= 3) {
      if (!remoteCircle || remoteCircle !== pairId) throw circleMismatchError();
    } else if (remoteCircle && remoteCircle !== pairId) {
      throw circleMismatchError();
    }
  }

  const next = structuredClone(localState);
  if (isFlatDayMap(next.answers)) next.answers = nestAnswersMap(next.answers);
  if (isFlatDayMap(next.reactions)) next.reactions = nestReactionsMap(next.reactions);

  const localCircle = next.activeCircleId || next.circleId || null;
  const accepted = new Set([localCircle, remoteCircle, pairId].filter(Boolean));

  let circleId;
  if (pairId) {
    circleId = pairId;
    accepted.clear();
    accepted.add(pairId);
  } else if (localCircle && remoteCircle && localCircle !== remoteCircle) {
    circleId = localCircle < remoteCircle ? localCircle : remoteCircle;
    if (localCircle !== circleId) remapCircle(next, localCircle, circleId);
  } else {
    circleId = pairId || expectedSyncCircleId(next) || remoteCircle || localCircle || null;
  }

  if (circleId) {
    next.circleId = circleId;
    next.activeCircleId = circleId;
  }

  next.startedUsingAt = [next.startedUsingAt, remotePayload.startedUsingAt].filter(Boolean).sort()[0] || next.startedUsingAt;
  next.defaultListsSeeded = Boolean(next.defaultListsSeeded || remotePayload.defaultListsSeeded);

  if (remotePayload.profile) {
    next.profile.partnerName = remotePayload.profile.name || next.profile.partnerName;
  }

  if (circleId) {
    next.answers = mergeAnswersForCircle(next.answers, remotePayload.answers || {}, circleId, accepted);
    next.history = mergeHistoryForCircle(next.history, remotePayload.history || [], circleId, accepted);
    next.reactions = mergeReactionsForCircle(next.reactions, remotePayload.reactions || {}, circleId, accepted);
    next.lists = mergeOwnedList(next.lists, remotePayload.lists || [], circleId, accepted);
    next.listItems = mergeOwnedList(next.listItems, remotePayload.listItems || [], circleId, accepted);
    next.reservations = mergeOwnedList(next.reservations, remotePayload.reservations || [], circleId, accepted);
    next.moments = mergeOwnedList(next.moments, remotePayload.moments || [], circleId, accepted);
    next.mediaAttachments = mergeOwnedList(
      next.mediaAttachments,
      remotePayload.mediaAttachments || [],
      circleId,
      accepted
    );
    next.importantDates = mergeOwnedList(next.importantDates, remotePayload.importantDates || [], circleId, accepted);
    next.domainEvents = mergeOwnedList(next.domainEvents, remotePayload.domainEvents || [], circleId, accepted);

    next.completedDays = Math.max(Number(next.completedDays) || 0, Number(remotePayload.completedDays) || 0);
    next.streak = Math.max(Number(next.streak) || 0, Number(remotePayload.streak) || 0);
    const localDone = next.lastCompletedCalendarDate || '';
    const remoteDone = remotePayload.lastCompletedCalendarDate || '';
    if (remoteDone > localDone) next.lastCompletedCalendarDate = remoteDone;

    if (remotePayload.calendarDate && (!next.calendarDate || remotePayload.calendarDate > next.calendarDate)) {
      next.calendarDate = remotePayload.calendarDate;
      next.questionId = remotePayload.questionId || next.questionId;
      next.dayIndex = remotePayload.dayIndex ?? next.dayIndex;
    } else if (remotePayload.calendarDate === next.calendarDate && remotePayload.questionId) {
      next.questionId = next.questionId || remotePayload.questionId;
    }
  }

  if (Array.isArray(remotePayload.periods)) {
    mergePeriods(next, remotePayload.periods, {
      now,
      remoteCircleId: remoteCircle
    });
  } else {
    next.periods = Array.isArray(next.periods) ? next.periods : [];
    if (pairId) {
      next.circleId = pairId;
      next.activeCircleId = next.activeCircleId || pairId;
    }
  }

  if (remotePayload.gardenContentVersion != null) {
    next.gardenContentVersion = Math.max(
      Number(next.gardenContentVersion) || 0,
      Number(remotePayload.gardenContentVersion) || 0
    );
  }

  return next;
}
