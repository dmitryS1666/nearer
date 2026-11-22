import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 8.5.2 (current stable at project setup).
 * appId is for hypothesis distribution only — re-check before store release.
 *
 * Layout:
 *   pwa/      — web PWA source + Vite build → pwa/www
 *   android/ — Capacitor Android shell
 *   ios/     — Capacitor iOS shell (Xcode / macOS required to build)
 */
const config: CapacitorConfig = {
  appId: 'app.blizhe.couple',
  appName: 'Ближе',
  webDir: 'pwa/www',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor'
  },
  android: {
    allowMixedContent: false
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile'
  },
  plugins: {
    // Enables the native HTTP plugin. App /api calls use an explicit CapacitorHttp
    // adapter (see pwa/platform/nativeHttp.js) so GET error statuses stay intact.
    CapacitorHttp: { enabled: true },
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#f4f0ff',
      androidSplashResourceName: 'splash',
      showSpinner: false
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#fbf9ff'
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#7657e8'
    }
  }
};

export default config;
