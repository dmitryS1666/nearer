import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INSTALL_DISMISS_KEY,
  installOfferMode,
  isIosDevice,
  isIosSafari,
  isRunningStandalone,
  readInstallDismissed,
  writeInstallDismissed,
  clearInstallDismissed
} from '../platform/pwaInstall.js';

describe('pwaInstall', () => {
  it('detects standalone display modes', () => {
    const win = {
      matchMedia: (q) => ({ matches: q.includes('standalone') }),
      navigator: {}
    };
    assert.equal(isRunningStandalone(win), true);
  });

  it('detects iOS Safari vs Chrome iOS', () => {
    const safari =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const chrome =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';
    assert.equal(isIosDevice(safari), true);
    assert.equal(isIosSafari(safari), true);
    assert.equal(isIosSafari(chrome), false);
  });

  it('offers prompt when deferred event exists', () => {
    assert.equal(
      installOfferMode({ deferredPrompt: {}, dismissed: false, isNative: false, ua: 'Chrome' }),
      'prompt'
    );
  });

  it('offers ios tip on Safari and respects dismiss for banner', () => {
    const safari =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const win = { matchMedia: () => ({ matches: false }), navigator: { standalone: false } };
    assert.equal(installOfferMode({ deferredPrompt: null, dismissed: false, isNative: false, ua: safari, win }), 'ios');
    assert.equal(installOfferMode({ deferredPrompt: null, dismissed: true, isNative: false, ua: safari, win }), null);
    assert.equal(
      installOfferMode({ deferredPrompt: null, dismissed: true, isNative: false, ua: safari, win, ignoreDismiss: true }),
      'ios'
    );
  });

  it('never offers on native or standalone', () => {
    const win = { matchMedia: () => ({ matches: true }), navigator: {} };
    assert.equal(installOfferMode({ deferredPrompt: {}, isNative: true }), null);
    assert.equal(installOfferMode({ deferredPrompt: {}, isNative: false, win }), null);
  });

  it('persists dismiss flag', () => {
    const store = new Map();
    const storage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
    assert.equal(readInstallDismissed(storage), false);
    writeInstallDismissed(storage);
    assert.equal(readInstallDismissed(storage), true);
    assert.equal(store.get(INSTALL_DISMISS_KEY), '1');
    clearInstallDismissed(storage);
    assert.equal(readInstallDismissed(storage), false);
  });
});
