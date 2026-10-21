/** Fields reserved for a future SupabaseCoupleRepository. Sync itself is not implemented. */
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
