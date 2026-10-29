import { buildPlusIntentMessage, parsePlusIntent } from './plusPlans.js';

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export function plusIntentAllowed(headers = {}, allowedOrigins = []) {
  if (header(headers, 'x-blizhe-intent') !== '1') return false;
  const site = header(headers, 'sec-fetch-site').toLowerCase();
  if (site === 'cross-site') return false;
  const origin = header(headers, 'origin');
  if (!origin) return true;
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (allowedOrigins.includes(origin)) return true;
  const host = header(headers, 'host');
  return Boolean(host) && originHost === host;
}

export function createPlusIntentService({
  store,
  mailer,
  now = () => new Date(),
  allowedOrigins = [],
  logger = { info() {}, error() {} }
} = {}) {
  async function handle({ method, path, rawBody = '', headers = {}, ip = '' }) {
    const route = String(path || '').split('?')[0];
    if (route !== '/api/plus/intent') return { status: 404, json: { error: 'not_found' } };
    if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
    if (!plusIntentAllowed(headers, allowedOrigins)) return { status: 403, json: { error: 'forbidden' } };
    if (Buffer.byteLength(String(rawBody)) > 2048) return { status: 413, json: { error: 'too_large' } };

    let body;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return { status: 400, json: { error: 'invalid_json' } };
    }
    const parsed = parsePlusIntent(body);
    if (parsed.error) return { status: 400, json: { error: parsed.error } };
    if (!mailer?.configured) return { status: 503, json: { error: 'email_not_configured' } };

    let claim;
    try {
      claim = store.claim({ ...parsed, ip, at: now() });
    } catch {
      logger.error('plus_intent_store_failed');
      return { status: 503, json: { error: 'unavailable' } };
    }
    if (claim.status === 'sent') return { status: 200, json: { ok: true, duplicate: true } };
    if (claim.status === 'rate_limited') return { status: 429, json: { error: 'rate_limited' } };
    if (claim.status === 'in_progress') return { status: 409, json: { error: 'in_progress' } };

    const message = buildPlusIntentMessage({ ...parsed, at: now() });
    try {
      await mailer.send({ subject: message.subject, text: message.text });
    } catch {
      try { store.markFailed(parsed.requestId, now()); } catch { /* keep the mail error */ }
      logger.error('plus_intent_mail_failed');
      return { status: 502, json: { error: 'mail_failed' } };
    }
    try {
      store.markSent(parsed.requestId, now());
    } catch {
      try { store.markSent(parsed.requestId, now()); } catch { /* provider already accepted */ }
    }
    logger.info('plus_intent_accepted');
    return { status: 200, json: { ok: true } };
  }

  return { handle };
}
