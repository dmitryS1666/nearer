/**
 * Storage adapter — IndexedDB (local-first).
 * Same implementation for web and Capacitor WebView.
 * Future: Preferences / SQLite only if IndexedDB proves unreliable on a device.
 */
export { getValue, setValue, clearAll } from '../storage.js';
