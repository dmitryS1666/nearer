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
