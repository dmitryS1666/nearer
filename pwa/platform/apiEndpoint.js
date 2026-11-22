import { runtime } from './runtime.js';

// Only native Capacitor builds talk to the remote API. Web/PWA stays same-origin.
// This is a public API origin, never a credential.
export const NATIVE_API_ORIGIN = 'https://nearer.other.dev-regiuslab.by';

export function apiEndpoint(path, { native = runtime.isNative() } = {}) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw new TypeError('apiEndpoint requires an absolute /api/ path');
  }
  return native ? `${NATIVE_API_ORIGIN}${path}` : path;
}
