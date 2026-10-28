/** localStorage key — soft dismiss of the home-screen install banner */
export const INSTALL_DISMISS_KEY = 'blizhe-install-dismissed';

export function isRunningStandalone(win = globalThis) {
  try {
    if (win.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    if (win.matchMedia?.('(display-mode: minimal-ui)')?.matches) return true;
    if (win.navigator?.standalone === true) return true;
  } catch {
    // ignore
  }
  return false;
}

export function isIosDevice(ua = globalThis.navigator?.userAgent || '') {
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS desktop UA
  try {
    return globalThis.navigator?.platform === 'MacIntel' && (globalThis.navigator?.maxTouchPoints || 0) > 1;
  } catch {
    return false;
  }
}

/** Safari on iOS/iPadOS can Add to Home Screen; Chrome/Firefox iOS cannot use beforeinstallprompt either. */
export function isIosSafari(ua = globalThis.navigator?.userAgent || '') {
  if (!isIosDevice(ua)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/i.test(ua)) return false;
  return /Safari/i.test(ua) || /AppleWebKit/i.test(ua);
}

export function readInstallDismissed(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(INSTALL_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeInstallDismissed(storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(INSTALL_DISMISS_KEY, '1');
  } catch {
    // ignore quota / private mode
  }
}

export function clearInstallDismissed(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.(INSTALL_DISMISS_KEY);
  } catch {
    // ignore
  }
}

/**
 * @returns {'prompt' | 'ios' | null}
 * Banner respects dismiss; settings can pass { ignoreDismiss: true }.
 */
export function installOfferMode({
  deferredPrompt = null,
  dismissed = false,
  isNative = false,
  ua = globalThis.navigator?.userAgent || '',
  win = globalThis,
  ignoreDismiss = false
} = {}) {
  if (isNative) return null;
  if (isRunningStandalone(win)) return null;
  if (dismissed && !ignoreDismiss) return null;
  if (deferredPrompt) return 'prompt';
  if (isIosSafari(ua) && !isRunningStandalone(win)) return 'ios';
  return null;
}
