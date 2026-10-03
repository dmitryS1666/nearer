import { getValue, setValue } from '../platform/storage.js';

const EVENTS_KEY = 'analytics_events';
const META_KEY = 'analytics_meta';

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let sessionId = uuid();
let installId = null;

export async function initAnalytics() {
  const meta = (await getValue(META_KEY, null)) || {};
  if (!meta.installId) {
    meta.installId = uuid();
    meta.createdAt = new Date().toISOString();
  }
  meta.lastOpenAt = new Date().toISOString();
  meta.sessionCount = (meta.sessionCount || 0) + 1;
  await setValue(META_KEY, meta);
  installId = meta.installId;
  sessionId = uuid();
  return { installId, sessionId, meta };
}

export function getSessionId() {
  return sessionId;
}

export function getInstallId() {
  return installId;
}

/**
 * Local-only analytics. Never stores full answer text.
 * Events are not sent anywhere without separate consent/integration.
 */
export async function track(type, properties = {}) {
  const safe = { ...properties };
  delete safe.answerText;
  delete safe.myAnswer;
  delete safe.partnerAnswer;
  delete safe.text;

  const event = {
    type,
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    properties: safe
  };

  const events = (await getValue(EVENTS_KEY, [])) || [];
  events.push(event);
  // Cap local log to keep IDB small during tests
  const trimmed = events.length > 2000 ? events.slice(-2000) : events;
  await setValue(EVENTS_KEY, trimmed);
  return event;
}

export async function getEvents() {
  return (await getValue(EVENTS_KEY, [])) || [];
}

export async function getAnalyticsMeta() {
  return (await getValue(META_KEY, {})) || {};
}

export async function clearAnalytics() {
  await setValue(EVENTS_KEY, []);
}

export async function buildExportPayload({ state, versionName }) {
  const events = await getEvents();
  const meta = await getAnalyticsMeta();
  const plusEvents = events.filter((e) => e.type === 'plus_viewed' || e.type === 'plus_cta_clicked');
  return {
    appVersion: versionName,
    installId: meta.installId || installId,
    exportedAt: new Date().toISOString(),
    sessions: meta.sessionCount || 0,
    streak: state?.streak ?? 0,
    completedDays: state?.completedDays ?? 0,
    plusInteractions: plusEvents.length,
    events: events.map(({ type, timestamp, session_id, properties }) => ({
      type,
      timestamp,
      session_id,
      properties
    }))
    // Private answers intentionally omitted
  };
}
