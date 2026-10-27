import { migrateState } from './schema.js';
import { normalizeDeviceLink } from './link.js';

export const BACKUP_KIND = 'blizhe-local-backup';
export const BACKUP_VERSION = 2;

/** A file the phone owner keeps. The pairing secret never leaves the device inside it. */
export function buildLocalBackup(state, now = new Date().toISOString()) {
  const copy = structuredClone(state);
  delete copy.deviceLink;
  return { kind: BACKUP_KIND, version: BACKUP_VERSION, exportedAt: now, state: copy };
}

/**
 * Restore archive onto this device without remapping old circleIds onto the live pair.
 * Current deviceLink (and thus sync target) is preserved from `current`.
 */
export function restoreLocalBackup(current, payload, options) {
  if (
    !payload ||
    payload.kind !== BACKUP_KIND ||
    (payload.version !== 1 && payload.version !== 2) ||
    !payload.state ||
    typeof payload.state !== 'object' ||
    Array.isArray(payload.state)
  ) {
    throw new Error('invalid_backup');
  }
  const incoming = structuredClone(payload.state);
  delete incoming.deviceLink;
  const link = normalizeDeviceLink(current?.deviceLink);
  const livePairId = link.pairId || null;
  const liveLastBound = current?.lastBoundPairId || livePairId || null;
  const liveActive = current?.activeCircleId || livePairId || null;

  const migrated = migrateState(incoming, options);
  migrated.deviceLink = link;

  if (livePairId) {
    // Stay linked to the current pair for sync, but do not rename backup entities.
    migrated.activeCircleId = livePairId;
    migrated.circleId = livePairId;
    migrated.lastBoundPairId = liveLastBound || livePairId;
    // Backup content is not a proven solo space of this install.
    migrated.soloCircleId = null;
    migrated.circleStats = {
      ...(migrated.circleStats || {}),
      ...(current.circleStats || {})
    };
  } else if (liveActive) {
    migrated.activeCircleId = migrated.activeCircleId || liveActive;
    migrated.lastBoundPairId = migrated.lastBoundPairId || liveLastBound;
  }

  return migrated;
}
