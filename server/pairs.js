const DEFAULT_LIMITS = { create: 8, join: 12, windowMs: 10 * 60 * 1000 };

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
      const created = store.create(at);
      return { status: 201, json: created };
    }

    if (method === 'POST' && route === '/api/pairs/join') {
      if (!allow(buckets, `join:${client}`, limits.join, limits.windowMs, at)) {
        return { status: 429, json: { error: 'rate_limited' } };
      }
      let body = {};
      try {
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        return { status: 400, json: { error: 'invalid_json' } };
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { status: 400, json: { error: 'invalid_json' } };
      }
      const joined = store.join(body.code, at);
      if (!joined) return { status: 404, json: { error: 'code_invalid' } };
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

    return { status: 404, json: { error: 'not_found' } };
  }

  return { handle };
}
