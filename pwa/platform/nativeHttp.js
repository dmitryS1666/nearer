import { CapacitorHttp } from '@capacitor/core';
import { apiEndpoint } from './apiEndpoint.js';
import { runtime } from './runtime.js';

/**
 * Capacitor 8.5.2's fetch patch sends GET/HEAD through the WebView interceptor
 * (`/_capacitor_http_interceptor_`). POST/PUT/DELETE use the native plugin.
 * API calls go through CapacitorHttp.request for every method so status codes
 * and JSON bodies stay on the fetch Response, without opening server CORS.
 */

function resolveUrl(url) {
  return typeof url === 'string' && url.startsWith('/api/') ? apiEndpoint(url) : url;
}

export function nativeRequestInit(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {};
  for (const [key, value] of Object.entries(options.headers || {})) {
    if (value == null) continue;
    headers[key] = String(value);
  }
  const request = { url, method, headers };
  const writesBody = method !== 'GET' && method !== 'HEAD' && options.body != null;
  if (!writesBody) return request;
  const contentType = `${headers['content-type'] || headers['Content-Type'] || ''}`.toLowerCase();
  if (contentType.includes('application/json')) {
    request.data = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    return request;
  }
  request.data = options.body;
  request.dataType = 'text';
  return request;
}

export function toFetchResponse(nativeResponse) {
  const status = Number(nativeResponse?.status);
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    const error = new TypeError('Failed to fetch');
    error.code = 'offline';
    throw error;
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(nativeResponse?.headers || {})) {
    if (!key || key === 'null' || value == null) continue;
    try {
      headers.set(key, String(value));
    } catch {
      // Drop header names the Fetch API rejects (for example a null status line).
    }
  }
  if (status === 204 || nativeResponse.data == null) {
    return new Response(null, { status, headers });
  }
  const body = typeof nativeResponse.data === 'string' ? nativeResponse.data : JSON.stringify(nativeResponse.data);
  return new Response(body, { status, headers });
}

export async function performNativeRequest(requestImpl, url, options) {
  let nativeResponse;
  try {
    nativeResponse = await requestImpl(nativeRequestInit(url, options));
  } catch (cause) {
    const error = new TypeError('Failed to fetch');
    error.code = 'offline';
    error.cause = cause;
    throw error;
  }
  return toFetchResponse(nativeResponse);
}

export async function platformFetch(url, options) {
  const target = resolveUrl(url);
  if (!runtime.isNative()) return globalThis.fetch(target, options);
  return performNativeRequest((init) => CapacitorHttp.request(init), target, options);
}
