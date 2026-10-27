import { normalizeActivePeriods, stampCompare, statusStampCompare } from './period.js';
import { periodsForSync } from './circleIdentity.js';
import { expectedSyncCircleId } from './ownership.js';

function answerStamp(entry) {
  return Date.parse(entry?.updatedAt || entry?.submittedAt || 0) || 0;
}

function pickAnswer(left, right) {
  if (!left) return right || undefined;
  if (!right) return left;
  const ls = answerStamp(left);
  const rs = answerStamp(right);
  if (rs !== ls) return rs > ls ? right : left;
  const lt = String(left.text || '');
  const rt = String(right.text || '');
  if (lt !== rt) return rt >= lt ? right : left;
  return String(right.submittedAt || '') >= String(left.submittedAt || '') ? right : left;
}

function mergeAnswerSlots(local = {}, remote = {}) {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const out = {};
  for (const qid of keys) {
    const L = local[qid] || {};
    const R = remote[qid] || {};
    out[qid] = {
      a: pickAnswer(L.a, R.a),
      b: pickAnswer(L.b, R.b)
    };
    if (!out[qid].a) delete out[qid].a;
    if (!out[qid].b) delete out[qid].b;
  }
  return out;
}

function pickChallenge(left, right) {
  if (!left) return right || undefined;
  if (!right) return left;
  const ls = Date.parse(left.updatedAt || 0) || 0;
  const rs = Date.parse(right.updatedAt || 0) || 0;
  if (rs !== ls) return rs > ls ? right : left;
  if (Boolean(left.done) !== Boolean(right.done)) return left.done ? left : right;
  return JSON.stringify(right) >= JSON.stringify(left) ? right : left;
}

function mergeChallenge(local = {}, remote = {}) {
  return {
    a: pickChallenge(local.a, remote.a),
    b: pickChallenge(local.b, remote.b)
  };
}

/**
 * Status merge uses statusUpdatedAt/statusVersion, not content updatedAt/version.
 * Order-independent; completed sticky unless a strictly newer status op exists.
 */
export function resolveStatus(local, remote) {
  const ls = local.status || 'active';
  const rs = remote.status || 'active';

  if (ls === rs) {
    return {
      status: ls,
      completedAt: pickLaterField(local.completedAt, remote.completedAt),
      pausedAt: pickLaterField(local.pausedAt, remote.pausedAt),
      conflictNote: pickConflictNote(local, remote, ls),
      statusUpdatedAt:
        pickLaterField(local.statusUpdatedAt, remote.statusUpdatedAt) ||
        local.statusUpdatedAt ||
        remote.statusUpdatedAt ||
        null,
      statusVersion: Math.max(Number(local.statusVersion) || 0, Number(remote.statusVersion) || 0)
    };
  }

  if (ls === 'completed' || rs === 'completed') {
    const completedSide = ls === 'completed' ? local : remote;
    const otherSide = ls === 'completed' ? remote : local;
    const cmp = statusStampCompare(otherSide, completedSide);
    if (cmp > 0 && otherSide.status !== 'completed') {
      return pickStatusBundle(otherSide);
    }
    return pickStatusBundle(completedSide);
  }

  const cmp = statusStampCompare(local, remote);
  if (cmp !== 0) {
    return pickStatusBundle(cmp > 0 ? local : remote);
  }

  // Equal status stamps: deterministic lexicographic status, then id.
  const byName = String(ls).localeCompare(String(rs));
  if (byName !== 0) return pickStatusBundle(byName > 0 ? local : remote);
  const byId = String(local.id || '').localeCompare(String(remote.id || ''));
  return pickStatusBundle(byId >= 0 ? local : remote);
}

function pickStatusBundle(src) {
  return {
    status: src.status || 'active',
    completedAt: src.completedAt || null,
    pausedAt: src.pausedAt || null,
    conflictNote: src.conflictNote || null,
    statusUpdatedAt: src.statusUpdatedAt || null,
    statusVersion: Number(src.statusVersion) || 0
  };
}

function pickLaterField(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function pickConflictNote(local, remote, status) {
  if (status !== 'paused') return local.conflictNote || remote.conflictNote || null;
  if (local.conflictNote === 'dual_active_paused' || remote.conflictNote === 'dual_active_paused') {
    return 'dual_active_paused';
  }
  return local.conflictNote || remote.conflictNote || null;
}

export function mergeOnePeriod(local, remote, canonicalCircle) {
  if (!local) {
    const copy = structuredClone(remote);
    if (canonicalCircle && !copy.circleId) copy.circleId = canonicalCircle;
    else if (canonicalCircle) copy.circleId = copy.circleId || canonicalCircle;
    return copy;
  }
  if (!remote) {
    return structuredClone(local);
  }
  const statusFields = resolveStatus(local, remote);
  const metaWinner = stampCompare(remote, local) >= 0 ? remote : local;
  const merged = {
    ...local,
    ...remote,
    id: local.id,
    circleId: local.circleId || remote.circleId || canonicalCircle || null,
    themeId: local.themeId || remote.themeId,
    startDate: local.startDate || remote.startDate,
    timeZone: local.timeZone || remote.timeZone,
    contentSnapshot: local.contentSnapshot || remote.contentSnapshot,
    answers: mergeAnswerSlots(local.answers, remote.answers),
    challenge: mergeChallenge(local.challenge, remote.challenge),
    status: statusFields.status,
    completedAt: statusFields.completedAt,
    pausedAt: statusFields.pausedAt,
    conflictNote: statusFields.conflictNote,
    statusUpdatedAt: statusFields.statusUpdatedAt,
    statusVersion: statusFields.statusVersion,
    createdAt: [local.createdAt, remote.createdAt].filter(Boolean).sort()[0] || local.createdAt,
    updatedAt: stampCompare(remote, local) >= 0 ? remote.updatedAt : local.updatedAt,
    version: Math.max(Number(local.version) || 0, Number(remote.version) || 0),
    syncStatus: 'pending',
    lastSyncedAt: metaWinner.lastSyncedAt || null
  };

  // Never overwrite a foreign circleId with canonical during merge of same id
  if (local.circleId && remote.circleId && local.circleId === remote.circleId) {
    merged.circleId = local.circleId;
  } else if (local.circleId && remote.circleId && local.circleId !== remote.circleId) {
    // Prefer the side that matches canonical / expected
    merged.circleId =
      (canonicalCircle && (local.circleId === canonicalCircle || remote.circleId === canonicalCircle)
        ? canonicalCircle
        : local.circleId) || remote.circleId;
  }

  const questions = merged.contentSnapshot?.questions || [];
  let mutual = 0;
  for (const q of questions) {
    const slot = merged.answers[q.id] || {};
    if (slot.a?.text?.trim() && slot.b?.text?.trim()) mutual += 1;
  }
  if (mutual >= 7 && merged.status !== 'completed') {
    merged.status = 'completed';
    merged.completedAt = merged.completedAt || merged.updatedAt;
    merged.pausedAt = null;
    merged.conflictNote = null;
  }
  if (local.status === 'completed' || remote.status === 'completed') {
    const sticky = resolveStatus(
      { ...local, status: local.status },
      { ...remote, status: remote.status }
    );
    if (sticky.status === 'completed') {
      merged.status = 'completed';
      merged.completedAt = sticky.completedAt || merged.completedAt;
      merged.pausedAt = null;
      merged.conflictNote = null;
      merged.statusUpdatedAt = sticky.statusUpdatedAt;
      merged.statusVersion = sticky.statusVersion;
    }
  }
  return merged;
}

/**
 * Merge remote periods into local.
 * When linked, only accept periods for the expected pair circle.
 */
export function mergePeriods(localState, remotePeriods = [], { now = new Date().toISOString(), remoteCircleId = null } = {}) {
  const expected = expectedSyncCircleId(localState);
  const pairId = localState.deviceLink?.pairId || null;
  const peerCircle = remoteCircleId || null;

  // Linked: remote payload circle must match bound pair (do not trust arbitrary remote circleId).
  if (pairId && peerCircle && peerCircle !== pairId) {
    return { state: localState, pausedIds: [], canonical: pairId, rejected: true };
  }

  const accepted = new Set();
  let canonical = null;
  if (pairId) {
    canonical = pairId;
    accepted.add(pairId);
  } else if (expected) {
    canonical = expected;
    accepted.add(expected);
    if (peerCircle && peerCircle === expected) accepted.add(peerCircle);
  } else if (localState.circleId && peerCircle && localState.circleId !== peerCircle) {
    // First-pair UUID join (no deviceLink yet): deterministic min id
    canonical = localState.circleId < peerCircle ? localState.circleId : peerCircle;
    accepted.add(localState.circleId);
    accepted.add(peerCircle);
  } else {
    canonical = localState.circleId || peerCircle || null;
    if (localState.circleId) accepted.add(localState.circleId);
    if (peerCircle) accepted.add(peerCircle);
  }

  if (canonical) {
    localState.circleId = canonical;
    if (!localState.activeCircleId) localState.activeCircleId = canonical;
  }

  const map = new Map();
  for (const p of localState.periods || []) {
    if (p?.id) map.set(p.id, structuredClone(p));
  }

  for (const remote of remotePeriods || []) {
    if (!remote?.id) continue;
    const rc = remote.circleId || null;
    if (rc) {
      if (accepted.size > 0 && !accepted.has(rc)) continue;
    } else if (pairId) {
      // Unscoped inbound while linked: adopt as current pair only
      remote.circleId = pairId;
    }
    const prev = map.get(remote.id);
    // Do not merge a remote period onto a local period that belongs to a different circle
    if (prev?.circleId && remote.circleId && prev.circleId !== remote.circleId) {
      if (pairId && prev.circleId !== pairId) {
        // Keep local foreign; add remote as separate if ids collide (shouldn't) — skip
        continue;
      }
    }
    map.set(remote.id, mergeOnePeriod(prev, remote, canonical));
  }

  localState.periods = [...map.values()];
  const { pausedIds } = normalizeActivePeriods(localState, { now, circleId: canonical });
  return { state: localState, pausedIds, canonical };
}

export function periodPayloadList(periods = [], circleId = null) {
  return periodsForSync(periods, circleId).map((p) => ({
    id: p.id,
    circleId: p.circleId || circleId || null,
    themeId: p.themeId,
    status: p.status,
    startDate: p.startDate,
    timeZone: p.timeZone,
    completedAt: p.completedAt || null,
    pausedAt: p.pausedAt || null,
    contentSnapshot: p.contentSnapshot,
    answers: p.answers || {},
    challenge: p.challenge || {},
    conflictNote: p.conflictNote || null,
    statusUpdatedAt: p.statusUpdatedAt || null,
    statusVersion: p.statusVersion || 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    version: p.version || 1
  }));
}

export { mergeAnswerSlots, statusStampCompare };
