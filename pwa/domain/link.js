const STATUSES = new Set(['solo', 'waiting', 'linked']);

export function emptyDeviceLink() {
  return {
    pairId: null,
    deviceToken: null,
    role: null,
    status: 'solo',
    linkedAt: null,
    inviteCode: null,
    inviteExpiresAt: null
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
  if (!next.deviceToken) return emptyDeviceLink();
  return next;
}

export function linkFromPairResult(result) {
  return normalizeDeviceLink({
    pairId: result.pairId,
    deviceToken: result.deviceToken,
    role: result.role,
    status: result.status,
    linkedAt: result.status === 'linked' ? new Date().toISOString() : null,
    inviteCode: result.code || null,
    inviteExpiresAt: result.expiresAt || null
  });
}
