/** localStorage key — soft dismiss of the home-screen install banner */
export const INSTALL_DISMISS_KEY = 'blizhe-install-dismissed';

/** Signed hypothesis APK. The site links here; the file is the GitHub release asset. */
export const ANDROID_APK_URL =
  'https://github.com/dmitryS1666/nearer/releases/download/android-hypothesis-0.1.0/blizhe-0.1.0-hypothesis.apk';

/**
 * Public ways to open Ближе. Hidden inside the native app.
 * @returns {{ id: 'pwa' | 'apk', label: string, detail: string, href: string }[]}
 */
export function distributionChoices({ native = false, pwaHref = '#start-form' } = {}) {
  if (native) return [];
  return [
    { id: 'pwa', label: 'В браузере', detail: 'Этот сайт, можно на экран', href: pwaHref },
    { id: 'apk', label: 'Android', detail: 'Скачать APK', href: ANDROID_APK_URL }
  ];
}

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
