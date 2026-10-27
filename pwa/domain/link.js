import { bindStateToPair as bindOwnership, rememberBoundPairOnLeave as rememberLeave } from './garden/ownership.js';

const STATUSES = new Set(['solo', 'waiting', 'linked']);

export function emptyDeviceLink() {
  return {
    pairId: null,
    deviceToken: null,
    role: null,
    status: 'solo',
    linkedAt: null,
    inviteCode: null,
    inviteExpiresAt: null,
    publicKey: null,
    privateKeyJwk: null,
    peerPublicKey: null,
    syncRevision: 0,
    lastSyncAt: null,
    syncError: null
  };
}

export function normalizeDeviceLink(link) {
  const next = emptyDeviceLink();
  if (!link || typeof link !== 'object') return next;
  next.pairId = typeof link.pairId === 'string' ? link.pairId : null;
  next.deviceToken = typeof link.deviceToken === 'string' ? link.deviceToken : null;
  next.role = link.role === 'a' || link.role === 'b' ? link.role : null;
  next.status = STATUSES.has(link.status) ? link.status : 'solo';
  next.linkedAt = typeof link.linkedAt === 'string' ? link.linkedAt : null;
  next.inviteCode = typeof link.inviteCode === 'string' ? link.inviteCode : null;
  next.inviteExpiresAt = typeof link.inviteExpiresAt === 'string' ? link.inviteExpiresAt : null;
  next.publicKey = typeof link.publicKey === 'string' ? link.publicKey : null;
  next.privateKeyJwk = link.privateKeyJwk && typeof link.privateKeyJwk === 'object' ? link.privateKeyJwk : null;
  next.peerPublicKey = typeof link.peerPublicKey === 'string' ? link.peerPublicKey : null;
  next.syncRevision = Number.isFinite(Number(link.syncRevision)) ? Number(link.syncRevision) : 0;
  next.lastSyncAt = typeof link.lastSyncAt === 'string' ? link.lastSyncAt : null;
  next.syncError = typeof link.syncError === 'string' ? link.syncError : null;
  if (!next.deviceToken) return emptyDeviceLink();
  return next;
}

export function linkFromPairResult(result, identity = {}) {
  return normalizeDeviceLink({
    pairId: result.pairId,
    deviceToken: result.deviceToken,
    role: result.role,
    status: result.status,
    linkedAt: result.linkedAt || (result.status === 'linked' ? new Date().toISOString() : null),
    inviteCode: result.code || null,
    inviteExpiresAt: result.expiresAt || null,
    publicKey: identity.publicKey || result.publicKey || null,
    privateKeyJwk: identity.privateKeyJwk || null,
    peerPublicKey: result.peerPublicKey || null,
    syncRevision: result.syncRevision || 0
  });
}

/** @deprecated use garden/ownership — kept as the single public bind API */
export function bindStateToPair(state, pairId, options) {
  return bindOwnership(state, pairId, options);
}

export function rememberBoundPairOnLeave(state) {
  return rememberLeave(state);
}
