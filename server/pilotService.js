import { createHash, randomBytes } from 'node:crypto';
import { adminPageHtml } from './adminPage.js';
import { buildDashboard } from './pilotMetrics.js';

export const PILOT_EVENTS = new Set([
  'app_opened',
  'onboarding_completed',
  'pair_created',
  'pair_joined',
  'pair_activated',
  'question_answered',
  'mutual_answer_completed',
  'garden_period_started',
  'garden_period_completed',
  'wishlist_item_created',
  'plus_viewed',
  'plus_intent_clicked',
  'feedback_submitted',
  'update_available',
  'update_started',
  'update_installed'
]);

const PRODUCT_EVENTS = new Set([
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

const FEEDBACK_TYPES = new Set(['bug', 'idea', 'impression', 'other']);
const STATUSES = new Set(['new', 'doing', 'done']);
const SCREENS = new Set(['today', 'settings', 'garden', 'packs', 'history']);
const AUDIENCES = new Set(['all', 'android', 'pwa', 'version']);
const BLOCKED_PROP_KEYS = /answer|text|title|body|note|photo|image|key|token|cipher|wish|message|name|email/i;

function too(status, error) {
  return { status, json: { error } };
}

function parseJson(raw) {
  if (!raw) return {};
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('invalid_json');
    throw error;
  }
  return body;
}

function cleanId(value, max = 80) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(text)) return '';
  return text.slice(0, max);
}

function sanitizeProps(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const next = {};
  for (const [key, value] of Object.entries(props)) {
    if (BLOCKED_PROP_KEYS.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = value;
    else if (typeof value === 'string' && value.length <= 40 && !/\s/.test(value)) next[key] = value;
  }
  return next;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function validateVersion(body) {
  if (body.platform !== 'android' && body.platform !== 'web') return 'bad_platform';
  if (!/^\d+\.\d+\.\d+$/.test(String(body.versionName || ''))) return 'bad_version';
  if (!Number.isInteger(body.versionCode) || body.versionCode < 1) return 'bad_code';
  if (body.platform === 'android') {
    if (!/^https:\/\/[^\s]+$/i.test(String(body.downloadUrl || ''))) return 'bad_url';
    if (!/^[a-f0-9]{64}$/.test(String(body.sha256 || ''))) return 'bad_sha';
  }
  if (typeof body.releaseNotes !== 'string' || body.releaseNotes.length > 2000) return 'bad_notes';
  return '';
}

export function createPilotService({
  store,
  auth,
  pairStore = null,
  mailer = null,
  dispatchPush = async () => ({ accepted: 0, failed: 0, status: 'not_configured', invalidIds: [] }),
  pushPublicKey = '',
  pushInfo = { webPush: false, fcm: false, note: 'Принято провайдером — это не прочтение.' },
  now = () => new Date(),
  pushMinIntervalMs = 10 * 60 * 1000
} = {}) {
  const feedbackHits = new Map();

  function allowFeedback(key, at) {
    const recent = (feedbackHits.get(key) || []).filter((stamp) => at - stamp < 60 * 60 * 1000);
    if (recent.length >= 5) {
      feedbackHits.set(key, recent);
      return false;
    }
    recent.push(at);
    feedbackHits.set(key, recent);
    return true;
  }

  function audit(action, detail = '') {
    store.addAudit({ ts: new Date(now()).toISOString(), action, detail: String(detail).slice(0, 180) });
  }

  function requireAdmin(headers) {
    const session = auth.sessionFromCookie(headers.cookie || '', now().getTime?.() ? now().getTime() : Date.parse(now()));
    if (!session) return { error: too(401, 'unauthorized') };
    return { session };
  }

  function requireCsrf(session, headers) {
    if (!auth.csrfOk(session, headers['x-csrf-token'] || headers['X-CSRF-Token'])) return too(403, 'csrf');
    return null;
  }

  async function handle({ method, path, rawBody = '', headers = {}, ip = '' }) {
    const route = String(path || '').split('?')[0];
    const query = new URLSearchParams(String(path || '').split('?')[1] || '');
    const at = now();
    const atMs = at instanceof Date ? at.getTime() : Date.parse(at);
    const iso = new Date(atMs).toISOString();

    if (method === 'GET' && (route === '/admin' || route === '/admin/')) {
      return {
        status: 200,
        json: null,
        body: adminPageHtml(),
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'"
        }
      };
    }

    if (!route.startsWith('/api/admin') && !route.startsWith('/api/pilot') && route !== '/api/feedback' && route !== '/api/app/version' && !route.startsWith('/api/push')) {
      return null;
    }

    if (method === 'GET' && route === '/api/app/version') {
      const platform = query.get('platform') === 'web' ? 'web' : 'android';
      const published = store.version(platform);
      if (!published) return too(404, 'not_published');
      return { status: 200, json: published };
    }

    if (method === 'POST' && route === '/api/pilot/events') {
      let body;
      try { body = parseJson(rawBody); } catch { return too(400, 'invalid_json'); }
      if (body.consent === 'denied') return { status: 202, json: { accepted: false, reason: 'consent' } };
      const type = String(body.event || '');
      if (!PILOT_EVENTS.has(type)) return too(400, 'unknown_event');
      if (PRODUCT_EVENTS.has(type) && body.consent !== 'granted') return { status: 202, json: { accepted: false, reason: 'consent' } };
      if (body.pairId || body.answer || body.text || body.answers) return too(400, 'private_field');
      const installId = cleanId(body.installId);
      if (!installId) return too(400, 'install_required');
      const pairHash = typeof body.pairHash === 'string' && /^[a-f0-9]{16,64}$/.test(body.pairHash) ? body.pairHash : '';
      store.addEvent({
        ts: iso,
        installId,
        event: type,
        platform: body.platform === 'android' || body.platform === 'ios' ? body.platform : 'pwa',
        versionName: String(body.versionName || '').slice(0, 20),
        versionCode: Number.isInteger(body.versionCode) ? body.versionCode : null,
        pairHash,
        role: body.role === 'a' || body.role === 'b' ? body.role : '',
        props: sanitizeProps(body.props)
      });
      return { status: 202, json: { accepted: true } };
    }

    if (method === 'POST' && route === '/api/feedback') {
      let body;
      try { body = parseJson(rawBody); } catch { return too(400, 'invalid_json'); }
      if (body.consent !== true) return too(400, 'consent_required');
      const type = String(body.type || '');
      if (!FEEDBACK_TYPES.has(type)) return too(400, 'bad_type');
      const message = String(body.message || '').trim();
      if (message.length < 4 || message.length > 4000) return too(400, 'bad_message');
      const installId = cleanId(body.installId) || 'unknown-install';
      const key = `${ip}:${installId}`;
      if (!allowFeedback(key, atMs)) return too(429, 'rate_limited');
      const digest = sha256(`${installId}:${message}`);
      const duplicate = store.feedback().some((item) => item.digest === digest && atMs - Date.parse(item.createdAt) < 60 * 60 * 1000);
      if (duplicate) return too(429, 'duplicate');
      let rating = null;
      if (body.rating != null && body.rating !== '') {
        rating = Number(body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return too(400, 'bad_rating');
      }
      const contact = String(body.contact || '').trim();
      if (contact && !/^[^\s@]+@[^\s@]+$/.test(contact)) return too(400, 'bad_contact');
      const entry = {
        id: randomBytes(12).toString('hex'),
        createdAt: iso,
        type,
        message,
        rating,
        contact,
        appVersion: String(body.appVersion || '').slice(0, 20),
        platform: String(body.platform || '').slice(0, 20),
        osVersion: String(body.osVersion || '').slice(0, 120),
        installId,
        status: 'new',
        note: '',
        reply: '',
        replySent: false,
        digest
      };
      store.addFeedback(entry);
      return { status: 201, json: { id: entry.id, status: 'new' } };
    }

    if (method === 'GET' && route === '/api/push/vapid') {
      if (!pushPublicKey) return too(404, 'not_configured');
      return { status: 200, json: { publicKey: pushPublicKey } };
    }

    if (method === 'POST' && route === '/api/push/register') {
      let body;
      try { body = parseJson(rawBody); } catch { return too(400, 'invalid_json'); }
      const installId = cleanId(body.installId);
      if (!installId) return too(400, 'install_required');
      const platform = body.platform === 'android' ? 'android' : 'pwa';
      const id = sha256(`${platform}:${body.token || body.endpoint || installId}`).slice(0, 40);
      if (platform === 'android' && typeof body.token !== 'string') return too(400, 'token_required');
      if (platform === 'pwa' && typeof body.endpoint !== 'string') return too(400, 'endpoint_required');
      store.upsertToken({
        id,
        installId,
        platform,
        token: platform === 'android' ? String(body.token).slice(0, 4096) : '',
        endpoint: platform === 'pwa' ? String(body.endpoint).slice(0, 2000) : '',
        p256dh: String(body.p256dh || '').slice(0, 200),
        auth: String(body.auth || '').slice(0, 80),
        versionName: String(body.versionName || '').slice(0, 20),
        announcements: body.announcements === true,
        technical: body.technical !== false,
        invalid: false,
        updatedAt: iso
      });
      return { status: 202, json: { id } };
    }

    if (method === 'POST' && route === '/api/admin/login') {
      let body;
      try { body = parseJson(rawBody); } catch { return too(400, 'invalid_json'); }
      const result = auth.login(String(ip || 'unknown'), body.password || '', atMs);
      if (result.error) {
        audit('login_failed', ip);
        return too(result.status, result.error);
      }
      audit('login', ip);
      return {
        status: 200,
        json: { ok: true, csrf: result.csrf },
        headers: { 'set-cookie': auth.cookie(result.token) }
      };
    }

    if (route.startsWith('/api/admin')) {
      const gate = requireAdmin(headers);
      if (gate.error) return gate.error;
      if (method !== 'GET' && method !== 'HEAD') {
        const csrf = requireCsrf(gate.session, headers);
        if (csrf) return csrf;
      }

      if (method === 'GET' && route === '/api/admin/session') {
        return { status: 200, json: { authenticated: true, csrf: gate.session.csrf } };
      }
      if (method === 'POST' && route === '/api/admin/logout') {
        auth.logout(gate.session.token);
        audit('logout');
        return { status: 200, json: { ok: true }, headers: { 'set-cookie': auth.clearedCookie() } };
      }
      if (method === 'GET' && route === '/api/admin/dashboard') {
        const pairSummary = pairStore?.summary ? pairStore.summary(atMs) : null;
        return { status: 200, json: buildDashboard({ events: store.events(), feedback: store.feedback(), pairSummary, now: atMs }) };
      }
      if (method === 'GET' && route === '/api/admin/feedback') {
        return {
          status: 200,
          json: {
            feedback: store.feedback().map((item) => ({ ...item, digest: undefined }))
          }
        };
      }
      const feedbackWrite = route.match(/^\/api\/admin\/feedback\/([a-f0-9]{24})$/);
      if (method === 'POST' && feedbackWrite) {
        let body;
        try { body = parseJson(rawBody); } catch { return too(400, 'invalid_json'); }
        if (!STATUSES.has(body.status)) return too(400, 'bad_status');
        const current = store.feedback().find((item) => item.id === feedbackWrite[1]);
        if (!current) return too(404, 'not_found');
        const reply = String(body.reply || '').slice(0, 4000);
        let replySent = current.replySent;
        if (reply && reply !== current.reply) {
          if (!current.contact) return too(400, 'no_contact');
          if (!mailer?.configured) {
            store.updateFeedback(current.id, { status: body.status, note: String(body.note || '').slice(0, 2000), reply, replySent: false });
            audit('feedback_reply_saved', current.id);
            return { status: 200, json: { ok: true, mailed: false, reason: 'mail_not_configured' } };
          }
          try {
            await mailer.send({ to: current.contact, subject: 'Ответ от Ближе', text: reply });
            replySent = true;
          } catch {
            store.updateFeedback(current.id, { status: body.status, note: String(body.note || '').slice(0, 2000), reply, replySent: false });
            return { status: 502, json: { error: 'mail_failed' } };
          }
        }
        store.updateFeedback(current.id, {
          status: body.status,
          note: String(body.note || '').slice(0, 2000),
          reply,
          replySent
        });
        audit('feedback_updated', current.id);
        return { status: 200, json: { ok: true, mailed: replySent } };
      }
      if (method === 'GET' && route === '/api/admin/versions') {
        return { status: 200, json: { versions: { android: store.version('android'), web: store.version('web') } } };
      }
      if (method === 'POST' && route === '/api/admin/versions') {
        let body;
        try { body = parseJson(rawBody); } catch { return too(400, 'invalid_json'); }
        const problem = validateVersion(body);
        if (problem) return too(400, problem);
        const record = {
          platform: body.platform,
          versionName: body.versionName,
          versionCode: body.versionCode,
          minimumSupportedVersionCode: Number.isInteger(body.minimumSupportedVersionCode) ? body.minimumSupportedVersionCode : 1,
          downloadUrl: body.platform === 'android' ? body.downloadUrl : '',
          sha256: body.platform === 'android' ? String(body.sha256).toLowerCase() : '',
          releaseNotes: body.releaseNotes,
          mandatory: Boolean(body.mandatory),
          publishedAt: iso
        };
        store.publishVersion(body.platform, record);
        audit('version_published', `${body.platform} ${body.versionName}`);
        return { status: 200, json: record };
      }
      if (method === 'GET' && route === '/api/admin/pushes') {
        const broadcasts = store.broadcasts().map(({ title, body, audience, kind, accepted, failed, createdAt, test, status }) => ({
          title, body, audience, kind, accepted, failed, createdAt, test, status
        }));
        return { status: 200, json: { broadcasts, push: pushInfo } };
      }
      if (method === 'POST' && route === '/api/admin/pushes') {
        let body;
        try { body = parseJson(rawBody); } catch { return too(400, 'invalid_json'); }
        const title = String(body.title || '').trim();
        const text = String(body.body || '').trim();
        if (title.length < 2 || title.length > 80 || text.length < 2 || text.length > 240) return too(400, 'bad_message');
        if (!SCREENS.has(body.screen)) return too(400, 'bad_screen');
        if (!AUDIENCES.has(body.audience)) return too(400, 'bad_audience');
        const test = body.test === true;
        if (!test && body.confirm !== true) return too(400, 'confirm_required');
        const lastMass = [...store.broadcasts()].reverse().find((item) => !item.test);
        if (!test && lastMass && atMs - Date.parse(lastMass.createdAt) < pushMinIntervalMs) return too(429, 'too_soon');
        const kind = body.kind === 'technical' ? 'technical' : 'product';
        let targets = store.tokens().filter((token) => !token.invalid);
        if (test) targets = targets.filter((token) => token.installId === body.testInstallId);
        else if (body.audience === 'android' || body.audience === 'pwa') targets = targets.filter((token) => token.platform === body.audience);
        else if (body.audience === 'version') targets = targets.filter((token) => token.versionName === body.versionName);
        if (kind === 'product') targets = targets.filter((token) => token.announcements);
        else targets = targets.filter((token) => token.technical);
        const result = await dispatchPush({ title, body: text, screen: body.screen, kind, targets });
        for (const id of result.invalidIds || []) store.invalidateToken(id);
        const entry = {
          id: randomBytes(8).toString('hex'),
          createdAt: iso,
          title,
          body: text,
          screen: body.screen,
          audience: test ? 'test' : body.audience,
          versionName: body.versionName || '',
          kind,
          accepted: result.accepted || 0,
          failed: result.failed || 0,
          test,
          status: result.status || 'sent'
        };
        store.addBroadcast(entry);
        audit(test ? 'push_test' : 'push_broadcast', title);
        return { status: 200, json: { accepted: entry.accepted, failed: entry.failed, status: entry.status } };
      }
      if (method === 'GET' && route === '/api/admin/audit') {
        return { status: 200, json: { audit: store.audit() } };
      }
      return too(404, 'not_found');
    }

    return too(404, 'not_found');
  }

  return { handle };
}
