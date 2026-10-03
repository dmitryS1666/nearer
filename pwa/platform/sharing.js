import { runtime } from './runtime.js';

export async function shareText({ title, text, dialogTitle } = {}) {
  if (runtime.isNative()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, dialogTitle: dialogTitle || title });
      return { ok: true, method: 'native' };
    } catch (err) {
      // fall through to clipboard
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return { ok: true, method: 'web-share' };
    } catch {
      // user cancelled or unsupported
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, method: 'clipboard' };
  } catch {
    return { ok: false, method: 'none' };
  }
}

export async function openExternalUrl(url) {
  if (!url) return false;
  if (runtime.isNative()) {
    try {
      const { App } = await import('@capacitor/app');
      // App.openUrl may not exist on all versions — use window as fallback
      window.open(url, '_system');
      return true;
    } catch {
      window.open(url, '_blank');
      return true;
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
