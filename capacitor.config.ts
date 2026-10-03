import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 8.5.2 (current stable at project setup).
 * appId is for hypothesis distribution only — re-check before store release.
 *
 * Layout:
 *   pwa/      — web PWA source + Vite build → pwa/www
 *   android/ — Capacitor Android shell
 */
const config: CapacitorConfig = {
  appId: 'app.blizhe.couple',
  appName: 'Ближе',
  webDir: 'pwa/www',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: false
  },
  plugins: {
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
