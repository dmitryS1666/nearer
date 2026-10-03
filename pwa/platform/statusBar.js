import { runtime } from './runtime.js';

export async function configureStatusBar() {
  if (!runtime.isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#fbf9ff' });
    if (runtime.isAndroid()) {
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
      } catch {
        // older plugin builds
      }
    }
  } catch (err) {
    console.warn('StatusBar config skipped', err);
  }
}
