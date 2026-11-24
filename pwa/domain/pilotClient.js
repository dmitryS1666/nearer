import { apiEndpoint } from '../platform/apiEndpoint.js';
import { platformFetch } from '../platform/nativeHttp.js';

export const PRODUCT_EVENTS = new Set([
  'app_opened',
  'onboarding_completed',
  'question_answered',
  'mutual_answer_completed',
  'garden_period_started',
  'garden_period_completed',
  'wishlist_item_created',
  'plus_viewed',
  'plus_intent_clicked',
  'feedback_submitted'
]);

export const TECHNICAL_EVENTS = new Set([
  'pair_created',
  'pair_joined',
  'pair_activated',
  'update_available',
  'update_started',
  'update_installed'
]);

export function eventMaySend(consent, type) {
  if (consent === 'denied') return false;
  if (PRODUCT_EVENTS.has(type)) return consent === 'granted';
  if (TECHNICAL_EVENTS.has(type)) return true;
  return false;
}

const BLOCKED = /answer|text|title|body|note|photo|image|key|token|cipher|wish|message|name|email/i;

export function sanitizeEventProps(props = {}) {
  const next = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (BLOCKED.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = value;
    else if (typeof value === 'string' && value.length <= 40 && !/\s/.test(value)) next[key] = value;
  }
  return next;
}

export async function hashPairId(pairId) {
  if (!pairId) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nearer-pair-v1:${pairId}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export async function postPilotEvent(payload) {
  const response = await platformFetch(apiEndpoint('/api/pilot/events'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.ok;
}

export async function postFeedback(payload) {
  const response = await platformFetch(apiEndpoint('/api/feedback'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || 'feedback_failed');
    error.code = json.error || 'feedback_failed';
    throw error;
  }
  return json;
}

export async function fetchAppVersion(platform) {
  const response = await platformFetch(apiEndpoint(`/api/app/version?platform=${encodeURIComponent(platform)}`), {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store'
  });
  if (response.status === 404) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) return null;
  return json;
}
