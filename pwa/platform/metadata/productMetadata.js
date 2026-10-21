import { getValue, setValue } from '../storage.js';

export const LINK_PREVIEW_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_KEY = 'link_preview_cache';

export function readCacheEntry(entry, now = Date.now(), ttl = LINK_PREVIEW_TTL_MS) {
  if (!entry || typeof entry.storedAt !== 'number') return null;
  if (now - entry.storedAt > ttl) return null;
  return entry.value || null;
}

const idbCache = {
  async read() {
    return (await getValue(CACHE_KEY, {})) || {};
  },
  async write(map) {
    await setValue(CACHE_KEY, map);
  }
};

/**
 * UI asks this provider for product metadata.
 * Parsing lives on POST /api/link-preview, not in the screen.
 */
export class ProductMetadataProvider {
  constructor({ endpoint = '/api/link-preview', fetchImpl, cache } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.cache = cache || idbCache;
  }

  async fetch(url, { force = false, now = Date.now() } = {}) {
    const key = String(url || '').trim();
    if (!key) throw new Error('invalid_url');
    const map = await this.cache.read();
    if (!force) {
      const hit = readCacheEntry(map[key], now);
      if (hit) return { ...hit, source: hit.source || 'cache' };
    }
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: key, force })
      });
    } catch {
      throw new Error('offline');
    }
    if (!response?.ok) throw new Error('preview_failed');
    const data = await response.json();
    map[key] = { storedAt: now, value: data };
    await this.cache.write(map);
    return data;
  }
}
