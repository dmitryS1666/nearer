/** Entity metadata used by encrypted pair sync (LWW via updatedAt + version). */
export function newEntity(fields, now) {
  return {
    ...fields,
    createdAt: fields.createdAt || now,
    updatedAt: now,
    syncStatus: 'pending',
    lastSyncedAt: null,
    version: 1
  };
}

export function touch(entity, now) {
  entity.updatedAt = now;
  entity.version = (entity.version || 1) + 1;
  entity.syncStatus = 'pending';
  return entity;
}

/** Status-only bump — does not pretend to be a content edit. */
export function touchStatus(entity, now) {
  entity.statusUpdatedAt = now;
  entity.statusVersion = (entity.statusVersion || 0) + 1;
  // Keep content clock moving for generic LWW of non-status fields, but status
  // resolution uses statusUpdatedAt/statusVersion exclusively.
  entity.updatedAt = now;
  entity.version = (entity.version || 1) + 1;
  entity.syncStatus = 'pending';
  return entity;
}
