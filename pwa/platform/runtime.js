import { Capacitor } from '@capacitor/core';

export const runtime = {
  isNative() {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  },
  isWeb() {
    return !this.isNative();
  },
  isAndroid() {
    try {
      return Capacitor.getPlatform() === 'android';
    } catch {
      return false;
    }
  },
  isIOS() {
    try {
      return Capacitor.getPlatform() === 'ios';
    } catch {
      return false;
    }
  },
  platform() {
    try {
      return Capacitor.getPlatform();
    } catch {
      return 'web';
    }
  }
};

/** Register SW only on web/PWA. On native, unregister any leftover registrations. */
export async function setupServiceWorker(onNavigate) {
  if (!('serviceWorker' in navigator)) return { registered: false };

  if (runtime.isNative()) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (err) {
      console.warn('SW cleanup failed', err);
    }
    return { registered: false, native: true };
  }

  try {
    await navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'NAVIGATE' && typeof onNavigate === 'function') {
        onNavigate(event.data.url);
      }
    });
    return { registered: true };
  } catch (err) {
    console.warn('SW registration failed', err);
    return { registered: false, error: String(err) };
  }
}
