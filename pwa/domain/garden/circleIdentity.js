/**
 * Couple identity for Garden sync.
 * Ownership policy lives in ownership.js — this module re-exports helpers
 * used by sync/merge and keeps periodsForSync for payload filtering.
 */

import { bindStateToPair, entitiesForCircle } from './ownership.js';

export function periodsForSync(periods, circleId) {
  if (!circleId) return [];
  // Only entities that can prove affiliation to this circle are sent.
  return entitiesForCircle(periods, circleId);
}

/**
 * @deprecated Prefer bindStateToPair from link.js / ownership.js
 */
export function adoptPairIdentity(state, pairId, options) {
  return bindStateToPair(state, pairId, options);
}

/**
 * Reconcile circle ids during sync merge when not using ownership expectedSyncCircleId.
 * Kept for tests/back-compat; mergePeriods is the authority for inbound sync.
 */
export function reconcileCircles(localState, remoteCircleId) {
  const local = localState.circleId || null;
  const remote = remoteCircleId || null;
  const pairId = localState.deviceLink?.pairId || null;
  const accepted = new Set([local, remote].filter(Boolean));

  let canonical = local || remote || pairId;
  if (pairId) {
    canonical = pairId;
    accepted.add(pairId);
  } else if (local && remote && local !== remote) {
    canonical = local < remote ? local : remote;
  }

  if (canonical) {
    localState.circleId = canonical;
    if (!localState.activeCircleId) localState.activeCircleId = canonical;
  }

  return { canonical: localState.circleId || null, accepted };
}

export function isAcceptablePeriodCircle(periodCircleId, { canonical, accepted }) {
  if (!periodCircleId) return true;
  if (canonical && periodCircleId === canonical) return true;
  if (accepted && accepted.has(periodCircleId)) return true;
  return false;
}
