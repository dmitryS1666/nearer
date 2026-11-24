import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function blank() {
  return { events: [], feedback: [], tokens: [], broadcasts: [], versions: {}, audit: [] };
}

function load(filePath) {
  if (!filePath) return blank();
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return { ...blank(), ...parsed };
  } catch {
    return blank();
  }
}

/**
 * Pilot analytics, feedback and release metadata.
 * Separate from the encrypted pair sync file. No answer text is accepted here.
 */
export function createPilotStore({
  filePath = null,
  now = () => new Date().toISOString(),
  retentionDays = 180,
  maxEvents = 50_000
} = {}) {
  let data = load(filePath);

  function persist() {
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, filePath);
  }

  function prune(at = now()) {
    const cutoff = Date.parse(at) - retentionDays * 24 * 60 * 60 * 1000;
    const before = data.events.length;
    data.events = data.events.filter((event) => Date.parse(event.ts) >= cutoff);
    if (data.events.length > maxEvents) data.events = data.events.slice(-maxEvents);
    if (data.audit.length > 2000) data.audit = data.audit.slice(-2000);
    if (data.events.length !== before) persist();
  }

  return {
    prune,
    addEvent(event) {
      data.events.push(event);
      prune(event.ts);
      persist();
      return event;
    },
    events() {
      return data.events;
    },
    addFeedback(entry) {
      data.feedback.push(entry);
      persist();
      return entry;
    },
    feedback() {
      return data.feedback;
    },
    updateFeedback(id, patch) {
      const item = data.feedback.find((entry) => entry.id === id);
      if (!item) return null;
      Object.assign(item, patch);
      persist();
      return item;
    },
    tokens() {
      return data.tokens;
    },
    upsertToken(entry) {
      const index = data.tokens.findIndex((item) => item.id === entry.id);
      if (index >= 0) data.tokens[index] = { ...data.tokens[index], ...entry };
      else data.tokens.push(entry);
      persist();
      return entry;
    },
    invalidateToken(id) {
      const item = data.tokens.find((token) => token.id === id);
      if (!item) return null;
      item.invalid = true;
      persist();
      return item;
    },
    addBroadcast(entry) {
      data.broadcasts.push(entry);
      persist();
      return entry;
    },
    broadcasts() {
      return data.broadcasts;
    },
    version(platform) {
      return data.versions[platform] || null;
    },
    publishVersion(platform, record) {
      data.versions[platform] = record;
      persist();
      return record;
    },
    addAudit(entry) {
      data.audit.push(entry);
      if (data.audit.length > 2000) data.audit = data.audit.slice(-2000);
      persist();
      return entry;
    },
    audit() {
      return data.audit;
    }
  };
}
