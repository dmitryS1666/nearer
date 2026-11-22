import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiEndpoint, NATIVE_API_ORIGIN } from '../platform/apiEndpoint.js';
import { nativeRequestInit, performNativeRequest, platformFetch, toFetchResponse } from '../platform/nativeHttp.js';
import { createPair, fetchPairSync, joinPair, putPairSync } from '../platform/link/pairClient.js';
import { postPlusIntent } from '../components/plus/plusIntent.js';
import { ProductMetadataProvider } from '../platform/metadata/productMetadata.js';

const ROOT = new URL('..', import.meta.url);
const PWA_DIR = fileURLToPath(ROOT);
const PLUS_ID = '11111111-1111-4111-8111-111111111111';

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'tests' || name === 'www' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkJs(path, out);
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

async function withFetch(handler, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = previous;
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

describe('api endpoint selection', () => {
  it('keeps web and PWA calls same-origin and sends native calls to the public HTTPS API', () => {
    assert.equal(apiEndpoint('/api/pairs', { native: false }), '/api/pairs');
    assert.equal(apiEndpoint('/api/pairs/sync', { native: false }), '/api/pairs/sync');
    assert.equal(apiEndpoint('/api/plus/intent', { native: false }), '/api/plus/intent');
    assert.equal(apiEndpoint('/api/link-preview', { native: false }), '/api/link-preview');
    assert.equal(apiEndpoint('/api/pairs', { native: true }), `${NATIVE_API_ORIGIN}/api/pairs`);
    assert.equal(apiEndpoint('/api/pairs/sync', { native: true }), `${NATIVE_API_ORIGIN}/api/pairs/sync`);
    assert.equal(NATIVE_API_ORIGIN.startsWith('https://'), true);
    assert.equal(NATIVE_API_ORIGIN.includes('localhost'), false);
    assert.equal(apiEndpoint('/api/pairs/me', { native: false }).includes('://'), false);
  });

  it('rejects relative api paths that would stay on the WebView origin', () => {
    assert.throws(() => apiEndpoint('api/pairs', { native: true }), TypeError);
    assert.throws(() => apiEndpoint('https://evil.example/api/pairs', { native: false }), TypeError);
    assert.throws(() => apiEndpoint('/health', { native: true }), TypeError);
  });
});

describe('native HTTP fetch semantics', () => {
  it('sends JSON objects without an Origin or Sec-Fetch-Site header', () => {
    const init = nativeRequestInit(`${NATIVE_API_ORIGIN}/api/pairs`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: 'abc' }),
      cache: 'no-store'
    });
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.data, { publicKey: 'abc' });
    assert.equal(typeof init.data, 'object');
    assert.equal(init.headers.origin, undefined);
    assert.equal(init.headers.Origin, undefined);
    assert.equal(init.headers['sec-fetch-site'], undefined);
    assert.equal(init.headers['Sec-Fetch-Site'], undefined);
  });

  it('keeps success, 403 and 409 as real HTTP responses and treats a dead socket as offline', async () => {
    const ok = await performNativeRequest(async () => ({
      status: 201,
      data: { code: 'AB12CD', status: 'waiting' },
      headers: { 'Content-Type': 'application/json; charset=utf-8', null: 'HTTP/1.1 201' }
    }), `${NATIVE_API_ORIGIN}/api/pairs`, { method: 'POST' });
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).code, 'AB12CD');

    const forbidden = await performNativeRequest(async () => ({
      status: 403,
      data: { error: 'forbidden' },
      headers: { 'content-type': 'application/json' }
    }), `${NATIVE_API_ORIGIN}/api/plus/intent`, { method: 'POST' });
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await forbidden.json(), { error: 'forbidden' });

    const conflict = toFetchResponse({
      status: 409,
      data: { error: 'conflict', revision: 4, ciphertext: 'cipher', iv: 'iviviviviviviviv' },
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.status, 409);
    const conflictBody = await conflict.json();
    assert.equal(conflictBody.error, 'conflict');
    assert.equal(conflictBody.revision, 4);

    const empty = toFetchResponse({ status: 204, data: null, headers: {} });
    assert.equal(empty.status, 204);
    assert.equal(await empty.text(), '');

    await assert.rejects(
      () => performNativeRequest(async () => ({ status: 0, data: '', headers: {} }), `${NATIVE_API_ORIGIN}/api/pairs/sync`, {}),
      (error) => error.code === 'offline'
    );
    await assert.rejects(
      () => performNativeRequest(async () => { throw new Error('socket'); }, `${NATIVE_API_ORIGIN}/api/pairs/sync`, {}),
      (error) => error.code === 'offline'
    );
  });
});

describe('web client routes', () => {
  it('pairs, joins and syncs on same-origin /api paths and keeps HTTP errors', async () => {
    const calls = [];
    await withFetch(async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/pairs') return jsonResponse(201, { code: 'ABCDEF', deviceToken: 'token-a', pairId: 'p1' });
      if (url === '/api/pairs/join') return jsonResponse(200, { deviceToken: 'token-b', pairId: 'p1' });
      if (url === '/api/pairs/sync' && options.method === 'PUT') return jsonResponse(409, { error: 'conflict', revision: 2 });
      if (url === '/api/pairs/sync') return jsonResponse(401, { error: 'unauthorized' });
      return jsonResponse(404, { error: 'not_found' });
    }, async () => {
      assert.equal((await createPair('pubkey')).code, 'ABCDEF');
      assert.equal((await joinPair('ABCDEF', 'pubkey-b')).deviceToken, 'token-b');
      await assert.rejects(() => fetchPairSync('token-a'), (error) => error.status === 401 && error.code === 'unauthorized');
      await assert.rejects(() => putPairSync('token-a', { ciphertext: 'c', iv: 'i', baseRevision: 1 }), (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, 'conflict');
        assert.equal(error.payload.revision, 2);
        return true;
      });
    });
    assert.deepEqual(calls.map((call) => call.url), ['/api/pairs', '/api/pairs/join', '/api/pairs/sync', '/api/pairs/sync']);
    for (const call of calls) {
      assert.equal(String(call.url).startsWith('/api/'), true);
      assert.equal(String(call.url).includes('localhost'), false);
      assert.equal(String(call.url).includes('capacitor://'), false);
    }
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { publicKey: 'pubkey' });
    assert.equal(calls[2].options.headers.authorization, 'Bearer token-a');
    assert.equal(calls[3].options.method, 'PUT');
  });

  it('maps a failed pair socket to offline instead of a successful body', async () => {
    await withFetch(async () => { throw new Error('network down'); }, async () => {
      await assert.rejects(() => createPair('pubkey'), (error) => error.code === 'offline');
    });
  });

  it('posts Plus to the same-origin path and does not treat 403, 409 or offline as success', async () => {
    let url = '';
    const ok = await postPlusIntent({
      plan: 'month',
      source: 'settings',
      requestId: PLUS_ID
    }, {
      online: () => true,
      fetchImpl: async (seen, options) => {
        url = seen;
        assert.equal(options.headers['x-blizhe-intent'], '1');
        assert.equal(options.headers.origin, undefined);
        return jsonResponse(200, { ok: true });
      }
    });
    assert.equal(ok.ok, true);
    assert.equal(url, '/api/plus/intent');

    await assert.rejects(() => postPlusIntent({
      plan: 'month', source: 'settings', requestId: PLUS_ID
    }, {
      online: () => true,
      fetchImpl: async () => jsonResponse(403, { error: 'forbidden' })
    }), (error) => error.code === 'forbidden');

    await assert.rejects(() => postPlusIntent({
      plan: 'month', source: 'settings', requestId: PLUS_ID
    }, {
      online: () => true,
      fetchImpl: async () => jsonResponse(409, { error: 'in_progress' })
    }), (error) => error.code === 'in_progress');

    await assert.rejects(() => postPlusIntent({
      plan: 'month', source: 'settings', requestId: PLUS_ID
    }, {
      online: () => true,
      fetchImpl: async () => { throw new Error('offline'); }
    }), (error) => error.code === 'offline');
  });

  it('asks link preview on /api/link-preview and surfaces offline and HTTP failures', async () => {
    const calls = [];
    const provider = new ProductMetadataProvider({
      cache: { async read() { return {}; }, async write() {} },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return jsonResponse(200, { title: 'Плед', url: 'https://shop.example/blanket' });
      }
    });
    const meta = await provider.fetch('https://shop.example/blanket');
    assert.equal(meta.title, 'Плед');
    assert.equal(calls[0].url, '/api/link-preview');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { url: 'https://shop.example/blanket', force: false });

    const failed = new ProductMetadataProvider({
      cache: { async read() { return {}; }, async write() {} },
      fetchImpl: async () => jsonResponse(502, { error: 'upstream' })
    });
    await assert.rejects(() => failed.fetch('https://shop.example/blanket'), /preview_failed/);

    const offline = new ProductMetadataProvider({
      cache: { async read() { return {}; }, async write() {} },
      fetchImpl: async () => { throw new Error('network'); }
    });
    await assert.rejects(() => offline.fetch('https://shop.example/blanket'), /offline/);
  });

  it('keeps an explicit web fetch on the relative /api path', async () => {
    await withFetch(async (url) => {
      assert.equal(url, '/api/pairs/me');
      return jsonResponse(401, { error: 'unauthorized' });
    }, async () => {
      const response = await platformFetch('/api/pairs/me', { method: 'GET' });
      assert.equal(response.status, 401);
      assert.equal(response.ok, false);
    });
  });
});

describe('no relative API calls left in the client', () => {
  it('routes every app /api call through the endpoint helper', () => {
    const files = walkJs(PWA_DIR);
    const offenders = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/fetch\(\s*['"`]\/?api\//.test(text)) offenders.push(file);
    }
    assert.deepEqual(offenders, []);
    const pairClient = readFileSync(new URL('./platform/link/pairClient.js', ROOT), 'utf8');
    const plus = readFileSync(new URL('./components/plus/plusIntent.js', ROOT), 'utf8');
    const preview = readFileSync(new URL('./platform/metadata/productMetadata.js', ROOT), 'utf8');
    const push = readFileSync(new URL('./push.js', ROOT), 'utf8');
    const sw = readFileSync(new URL('./public/sw.js', ROOT), 'utf8');
    const config = readFileSync(new URL('../capacitor.config.ts', ROOT), 'utf8');
    for (const source of [pairClient, plus, preview]) {
      assert.match(source, /apiEndpoint\(/);
      assert.match(source, /platformFetch/);
    }
    assert.match(push, /platformFetch/);
    assert.match(push, /apiEndpoint\(/);
    assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
    assert.match(config, /CapacitorHttp:\s*\{\s*enabled:\s*true\s*\}/);
  });
});
