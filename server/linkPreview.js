import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { detectStore, wildberriesNm } from '../pwa/platform/metadata/stores.js';

export { detectStore, wildberriesNm };

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 1_500_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const PUBLIC_ERRORS = new Set([
  'invalid_url',
  'blocked_protocol',
  'blocked_host',
  'blocked_ip',
  'blocked_url',
  'dns_failed',
  'too_large',
  'unsupported_type',
  'timeout',
  'preview_failed'
]);

const memoryCache = new Map();
const rateBuckets = new Map();

export function isPrivateAddress(ip) {
  const normalized = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized || normalized === '::1' || normalized === '::' || normalized === '0.0.0.0') return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (normalized.includes(':')) {
    if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true;
    }
    return false;
  }
  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 51) && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

export function assertPublicHttpUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw new Error('invalid_url'); }
  if (url.username || url.password) throw new Error('blocked_url');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('blocked_protocol');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('blocked_host');
  if (/^\d+$/.test(host)) throw new Error('blocked_host');
  if (isIP(host) && isPrivateAddress(host)) throw new Error('blocked_ip');
  return url;
}

export async function assertResolvedPublic(url, lookupImpl = dnsLookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('blocked_ip');
    return;
  }
  let records = [];
  try {
    records = await lookupImpl(host, { all: true, verbatim: true });
  } catch {
    throw new Error('dns_failed');
  }
  if (!records?.length) throw new Error('dns_failed');
  for (const record of records) {
    if (isPrivateAddress(record.address)) throw new Error('blocked_ip');
  }
}

export function parseLoosePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null) return null;
  const cleaned = String(value).replace(/\s|\u00a0/g, '').replace(',', '.');
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

export function metadataFromHtml(html, pageUrl) {
  const jsonLd = readJsonLd(html);
  const openGraph = readOpenGraph(html);
  const meta = blankMeta(pageUrl);
  if (jsonLd) {
    overlay(meta, jsonLd);
    meta.source = 'json-ld';
  }
  const hadTitle = Boolean(meta.title);
  overlay(meta, openGraph);
  if (!hadTitle && meta.title) meta.source = 'opengraph';
  if (!meta.currency && meta.price != null) meta.currency = 'RUB';
  return meta;
}

export function composeMetadata({ url, html = '', wbProduct = null, ozonHint = null, goldHint = null }) {
  const meta = html ? metadataFromHtml(html, url) : blankMeta(url);
  const store = detectStore(url);
  if (store) {
    meta.store = store.name;
    meta.storeDomain = store.domain;
  }
  if (store?.id === 'wildberries' && wbProduct) {
    overlay(meta, fromWildberriesProduct(wbProduct, url), { override: true });
    meta.source = 'wildberries';
  }
  if (store?.id === 'ozon') {
    const extra = ozonHint || (html ? fromOzonHtml(html) : null);
    if (extra && (extra.price || extra.title || extra.imageUrl)) {
      overlay(meta, extra, { override: meta.source === 'fallback' });
      if (meta.source === 'fallback') meta.source = 'ozon';
    }
  }
  if (store?.id === 'goldapple') {
    const extra = goldHint || (html ? fromGoldenAppleHtml(html) : null);
    if (extra && (extra.price || extra.title || extra.imageUrl)) {
      overlay(meta, extra, { override: meta.source === 'fallback' });
      if (meta.source === 'fallback') meta.source = 'goldapple';
    }
  }
  if (!meta.currency && meta.price != null) meta.currency = 'RUB';
  if (!meta.title) meta.title = store?.name || hostnameOf(url);
  return meta;
}

export function fromWildberriesProduct(product, pageUrl) {
  const nm = product?.id || product?.nmId || wildberriesNm(pageUrl);
  const price = product?.salePriceU != null ? product.salePriceU / 100 : parseLoosePrice(product?.salePrice);
  const old = product?.priceU != null ? product.priceU / 100 : parseLoosePrice(product?.price);
  return {
    title: product?.name || '',
    description: product?.brand || '',
    imageUrl: nm ? wildberriesImage(nm) : '',
    price,
    oldPrice: old && price && old > price ? old : null,
    currency: 'RUB',
    store: 'Wildberries',
    storeDomain: 'wildberries.ru',
    url: pageUrl
  };
}

export function wildberriesImage(nm) {
  const id = Number(nm);
  if (!Number.isFinite(id)) return '';
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  const host = wbBasket(vol);
  return `https://basket-${host}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/1.webp`;
}

export function fromOzonHtml(html) {
  const finalPrice = matchNumber(html, /"finalPrice"\s*:\s*"?(\d+)/i) || matchNumber(html, /"cardPrice"\s*:\s*"?(\d+)/i);
  const original = matchNumber(html, /"originalPrice"\s*:\s*"?(\d+)/i);
  return {
    price: finalPrice,
    oldPrice: original && finalPrice && original > finalPrice ? original : null,
    currency: 'RUB',
    store: 'Ozon',
    storeDomain: 'ozon.ru'
  };
}

export function fromGoldenAppleHtml(html) {
  const price = matchNumber(html, /itemprop="price"\s+content="(\d+(?:[.,]\d+)?)"/i)
    || matchNumber(html, /"price"\s*:\s*\{\s*"value"\s*:\s*(\d+(?:[.,]\d+)?)/i);
  return {
    price,
    currency: 'RUB',
    store: 'Золотое Яблоко',
    storeDomain: 'goldapple.ru'
  };
}

export function rateLimit(ip, now = Date.now(), max = 30) {
  const key = ip || 'local';
  const recent = (rateBuckets.get(key) || []).filter((stamp) => now - stamp < 60_000);
  if (recent.length >= max) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return true;
}

export async function previewLink(rawUrl, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const lookupImpl = deps.lookupImpl || dnsLookup;
  const now = deps.now || Date.now();
  const cache = deps.cache || memoryCache;
  let pageUrl;
  try {
    pageUrl = assertPublicHttpUrl(rawUrl);
  } catch (error) {
    return { ok: false, error: publicError(error) };
  }
  const cacheKey = pageUrl.href;
  if (!deps.force) {
    const cached = cache.get(cacheKey);
    if (cached && now - cached.storedAt < CACHE_TTL_MS) return { ok: true, data: cached.value };
  }
  try {
    const store = detectStore(pageUrl.href);
    let wbProduct = null;
    if (store?.id === 'wildberries') {
      const nm = wildberriesNm(pageUrl.href);
      if (nm) {
        const apiUrl = `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&nm=${nm}`;
        const api = await safeGet(apiUrl, { fetchImpl, lookupImpl });
        wbProduct = api.json?.data?.products?.[0] || null;
      }
    }
    let html = '';
    if (!wbProduct?.name) {
      const page = await safeGet(pageUrl.href, { fetchImpl, lookupImpl });
      html = page.text || '';
    }
    const data = composeMetadata({ url: pageUrl.href, html, wbProduct });
    cache.set(cacheKey, { storedAt: now, value: data });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: publicError(error) };
  }
}

export async function handleLinkPreviewRequest(body, deps = {}) {
  if (deps.ip && !rateLimit(deps.ip, deps.now)) return { status: 429, json: { error: 'rate_limited' } };
  let payload = body;
  if (typeof body === 'string') {
    try { payload = JSON.parse(body || '{}'); } catch { return { status: 400, json: { error: 'invalid_json' } }; }
  }
  if (!payload || typeof payload.url !== 'string') return { status: 400, json: { error: 'invalid_url' } };
  const result = await previewLink(payload.url, { ...deps, force: Boolean(payload.force || deps.force) });
  if (!result.ok) {
    const status = result.error === 'preview_failed' || result.error === 'too_large' || result.error === 'unsupported_type' || result.error === 'timeout' ? 422 : 400;
    return { status, json: { error: result.error } };
  }
  return { status: 200, json: result.data };
}

async function safeGet(rawUrl, { fetchImpl, lookupImpl, redirects = 0 } = {}) {
  if (redirects > MAX_REDIRECTS) throw new Error('preview_failed');
  const url = assertPublicHttpUrl(rawUrl);
  await assertResolvedPublic(url, lookupImpl);
  const response = await fetchImpl(url.href, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; NearerLinkPreview/1.0)',
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'ru,en;q=0.8'
    }
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error('preview_failed');
    const next = new URL(location, url).href;
    return safeGet(next, { fetchImpl, lookupImpl, redirects: redirects + 1 });
  }
  if (!response.ok) throw new Error('preview_failed');
  const type = (response.headers.get('content-type') || '').toLowerCase();
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throw new Error('too_large');
  const allowed = ['text/html', 'application/xhtml+xml', 'application/json', 'text/plain', 'application/ld+json'];
  if (type && !allowed.some((item) => type.includes(item))) throw new Error('unsupported_type');
  const text = await readLimited(response, MAX_BYTES);
  if (!type && text && !text.trim().startsWith('<') && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
    throw new Error('unsupported_type');
  }
  let json = null;
  if (type.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { text, json };
}

async function readLimited(response, max) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > max) throw new Error('too_large');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error('too_large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function blankMeta(url) {
  const store = detectStore(url);
  return {
    url,
    title: '',
    description: '',
    imageUrl: '',
    price: null,
    oldPrice: null,
    currency: null,
    store: store?.name || hostnameOf(url),
    storeDomain: store?.domain || hostnameOf(url),
    source: 'fallback'
  };
}

function overlay(meta, patch, { override = false } = {}) {
  if (!patch) return meta;
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') continue;
    if (override || meta[key] == null || meta[key] === '') meta[key] = value;
  }
  return meta;
}

function readOpenGraph(html) {
  if (!html) return null;
  const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
  const description = metaContent(html, 'og:description') || metaContent(html, 'description');
  const imageUrl = resolveMaybe(metaContent(html, 'og:image') || metaContent(html, 'twitter:image'));
  const price = parseLoosePrice(metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount'));
  const oldPrice = parseLoosePrice(metaContent(html, 'product:original_price:amount'));
  const currency = (metaContent(html, 'product:price:currency') || metaContent(html, 'og:price:currency') || '').toUpperCase();
  if (!title && !imageUrl && price == null) return null;
  return { title: cleanText(title), description: cleanText(description), imageUrl, price, oldPrice, currency };
}

function readJsonLd(html) {
  if (!html) return null;
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    let data;
    try { data = JSON.parse(block[1].trim()); } catch { continue; }
    const product = findProduct(data);
    if (!product) continue;
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers || {};
    const price = parseLoosePrice(offer.price ?? offer.lowPrice ?? product.price);
    const oldPrice = parseLoosePrice(offer.highPrice);
    const image = Array.isArray(product.image) ? product.image[0] : (product.image?.url || product.image || '');
    return {
      title: cleanText(product.name || ''),
      description: cleanText(product.description || ''),
      imageUrl: typeof image === 'string' ? image : '',
      price,
      oldPrice: oldPrice && price && oldPrice > price ? oldPrice : null,
      currency: offer.priceCurrency || product.priceCurrency || null
    };
  }
  return null;
}

function findProduct(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((item) => String(item || '').toLowerCase() === 'product')) return node;
  if (Array.isArray(node['@graph'])) return findProduct(node['@graph']);
  return null;
}

function metaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${key}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return '';
}

function matchNumber(html, pattern) {
  const match = html.match(pattern);
  return match ? parseLoosePrice(match[1]) : null;
}

function resolveMaybe(value) {
  return value || '';
}

function cleanText(value) {
  return decodeEntities(String(value || '')).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function publicError(error) {
  const code = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : error?.message;
  return PUBLIC_ERRORS.has(code) ? code : 'preview_failed';
}

function wbBasket(vol) {
  const ranges = [
    [143, '01'], [287, '02'], [431, '03'], [719, '04'], [1007, '05'], [1061, '06'],
    [1115, '07'], [1169, '08'], [1313, '09'], [1601, '10'], [1655, '11'], [1919, '12'],
    [2045, '13'], [2189, '14'], [2405, '15'], [2621, '16'], [2837, '17'], [3053, '18'],
    [3269, '19'], [3485, '20'], [3701, '21'], [3917, '22'], [4133, '23'], [4349, '24'],
    [4565, '25'], [4877, '26'], [5189, '27'], [5501, '28'], [5813, '29'], [6125, '30'],
    [6437, '31']
  ];
  for (const [max, host] of ranges) if (vol <= max) return host;
  return String(Math.max(32, Math.ceil(vol / 312))).padStart(2, '0');
}
