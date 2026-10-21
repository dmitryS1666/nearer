import { migrateState } from './schema.js';
import { normalizeDeviceLink } from './link.js';

export const BACKUP_KIND = 'blizhe-local-backup';

/** A file the phone owner keeps. The pairing secret never leaves the device inside it. */
export function buildLocalBackup(state, now = new Date().toISOString()) {
  const copy = structuredClone(state);
  delete copy.deviceLink;
  return { kind: BACKUP_KIND, version: 1, exportedAt: now, state: copy };
}

export function restoreLocalBackup(current, payload, options) {
  if (!payload || payload.kind !== BACKUP_KIND || payload.version !== 1 || !payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
    throw new Error('invalid_backup');
  }
  const incoming = structuredClone(payload.state);
  delete incoming.deviceLink;
  const migrated = migrateState(incoming, options);
  migrated.deviceLink = normalizeDeviceLink(current?.deviceLink);
  return migrated;
}
