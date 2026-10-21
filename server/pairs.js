const DEFAULT_LIMITS = { create: 8, join: 12, sync: 60, windowMs: 10 * 60 * 1000 };

function bearer(header) {
  const match = String(header || '').match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
  return match ? match[1] : '';
}

function allow(buckets, key, limit, windowMs, at) {
  const recent = (buckets.get(key) || []).filter((stamp) => at - stamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(at);
  buckets.set(key, recent);
  return true;
}

function parseJson(rawBody) {
  if (!rawBody) return {};
  const body = JSON.parse(rawBody);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('invalid_json');
    error.code = 'invalid_json';
    throw error;
  }
  return body;
}

export function createPairService(store, { now = () => Date.now(), limits = DEFAULT_LIMITS } = {}) {
  const buckets = new Map();

  function handle({ method, path, rawBody = '', authorization = '', ip = '' }) {
    const at = now();
    const route = String(path || '').split('?')[0];
    const token = bearer(authorization);
    const client = String(ip || 'unknown').slice(0, 80);

    if (method === 'POST' && route === '/api/pairs') {
      if (!allow(buckets, `create:${client}`, limits.create, limits.windowMs, at)) {
        return { status: 429, json: { error: 'rate_limited' } };
      }
      let body;
      try {
        body = parseJson(rawBody);
      } catch {
        return { status: 400, json: { error: 'invalid_json' } };
      }
      const created = store.create(at, { publicKey: body.publicKey });
      if (created?.error === 'public_key_required') return { status: 400, json: { error: 'public_key_required' } };
      return { status: 201, json: created };
    }

    if (method === 'POST' && route === '/api/pairs/join') {
      if (!allow(buckets, `join:${client}`, limits.join, limits.windowMs, at)) {
        return { status: 429, json: { error: 'rate_limited' } };
      }
      let body;
      try {
        body = parseJson(rawBody);
      } catch {
        return { status: 400, json: { error: 'invalid_json' } };
      }
      const joined = store.join(body.code, at, { publicKey: body.publicKey });
      if (joined?.error === 'public_key_required') return { status: 400, json: { error: 'public_key_required' } };
      if (joined?.error === 'public_key_reuse') return { status: 400, json: { error: 'public_key_reuse' } };
      if (joined?.error === 'code_invalid' || !joined) return { status: 404, json: { error: 'code_invalid' } };
      return { status: 200, json: joined };
    }

    if (method === 'GET' && route === '/api/pairs/me') {
      const status = token ? store.me(token, at) : null;
      if (!status) return { status: 401, json: { error: 'unauthorized' } };
      return { status: 200, json: status };
    }

    if (method === 'DELETE' && route === '/api/pairs/me') {
      if (!token || !store.leave(token)) return { status: 401, json: { error: 'unauthorized' } };
      return { status: 200, json: { status: 'solo' } };
    }

    if (method === 'GET' && route === '/api/pairs/sync') {
      if (!token) return { status: 401, json: { error: 'unauthorized' } };
      const result = store.getSync(token, at);
      if (result.error === 'unauthorized') return { status: 401, json: { error: 'unauthorized' } };
      if (result.error === 'not_linked') return { status: 409, json: { error: 'not_linked' } };
      return { status: 200, json: result };
    }

    if (method === 'PUT' && route === '/api/pairs/sync') {
      if (!token) return { status: 401, json: { error: 'unauthorized' } };
      if (!allow(buckets, `sync:${client}`, limits.sync, limits.windowMs, at)) {
        return { status: 429, json: { error: 'rate_limited' } };
      }
      let body;
      try {
        body = parseJson(rawBody);
      } catch {
        return { status: 400, json: { error: 'invalid_json' } };
      }
      const result = store.putSync(token, body, at);
      if (result.error === 'unauthorized') return { status: 401, json: { error: 'unauthorized' } };
      if (result.error === 'not_linked') return { status: 409, json: { error: 'not_linked' } };
      if (result.error === 'conflict') return { status: 409, json: result };
      if (result.error) return { status: 400, json: { error: result.error } };
      return { status: 200, json: result };
    }

    return { status: 404, json: { error: 'not_found' } };
  }

  return { handle };
}
