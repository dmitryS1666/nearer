import { config } from '../config.js';
import { runtime } from './runtime.js';
import { backgroundPushConfigured, getExistingPushSubscription, subscribeBackgroundPush } from '../push.js';

/**
 * NotificationService abstraction
 *  ├── WebNotificationProvider  (Push API + SW + Notifications API)
 *  └── NativeNotificationProvider (Capacitor Local Notifications)
 *
 * Future remote push (post-hypothesis):
 *   Supabase → Edge Function → FCM/APNs → Capacitor Push Notifications
 */

function parseReminderTime(hhmm = '20:00') {
  const [h, m] = String(hhmm).split(':').map((n) => Number(n));
  return { hour: Number.isFinite(h) ? h : 20, minute: Number.isFinite(m) ? m : 0 };
}

class WebNotificationProvider {
  async requestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    const result = await Notification.requestPermission();
    return result;
  }

  async getPermissionStatus() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  async scheduleDailyReminder(time) {
    // Web hypothesis: no reliable OS-level daily schedule without backend.
    // Permission + local prefs are stored; true scheduling needs Push/server or Periodic Sync.
    return { scheduled: false, reason: 'web-requires-server-or-periodic-sync', time };
  }

  async cancelDailyReminder() {
    return { cancelled: false, reason: 'web-no-local-schedule' };
  }

  async sendDebugNotification({ title, body, url = '/?screen=today', tag = 'blizhe-debug' } = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const registration = await navigator.serviceWorker?.ready.catch?.(() => null);
    if (registration?.showNotification) {
      await registration.showNotification(title, {
        body,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag,
        data: { url }
      });
      return true;
    }
    new Notification(title, { body });
    return true;
  }

  async handleNotificationTap() {
    // Handled via SW postMessage → NAVIGATE
  }

  backgroundPushConfigured() {
    return backgroundPushConfigured();
  }

  getExistingPushSubscription() {
    return getExistingPushSubscription();
  }

  subscribeBackgroundPush() {
    return subscribeBackgroundPush();
  }
}

class NativeNotificationProvider {
  async #plugin() {
    return import('@capacitor/local-notifications');
  }

  async requestPermission() {
    try {
      const { LocalNotifications } = await this.#plugin();
      const current = await LocalNotifications.checkPermissions();
      if (current.display === 'granted') return 'granted';
      const result = await LocalNotifications.requestPermissions();
      return result.display === 'granted' ? 'granted' : result.display || 'denied';
    } catch {
      return 'unsupported';
    }
  }

  async getPermissionStatus() {
    try {
      const { LocalNotifications } = await this.#plugin();
      const current = await LocalNotifications.checkPermissions();
      return current.display || 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  async scheduleDailyReminder(time = config.demoPartner ? '20:00' : '20:00') {
    const { hour, minute } = parseReminderTime(time);
    try {
      const { LocalNotifications } = await this.#plugin();
      await LocalNotifications.cancel({ notifications: [{ id: 1001 }] });
      await LocalNotifications.schedule({
        notifications: [
          {
            id: 1001,
            title: '❤️ Время для вашего вопроса',
            body: 'Откройте Ближе — маленький ритуал на сегодня.',
            schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
            extra: { screen: 'today', kind: 'daily' },
            smallIcon: 'ic_stat_icon',
            iconColor: '#7657e8'
          }
        ]
      });
      return { scheduled: true, hour, minute };
    } catch (err) {
      console.warn('scheduleDailyReminder failed', err);
      return { scheduled: false, reason: String(err) };
    }
  }

  async cancelDailyReminder() {
    try {
      const { LocalNotifications } = await this.#plugin();
      await LocalNotifications.cancel({ notifications: [{ id: 1001 }] });
      return { cancelled: true };
    } catch (err) {
      return { cancelled: false, reason: String(err) };
    }
  }

  async sendDebugNotification({ title, body, url = '/?screen=today', tag = 'debug' } = {}) {
    try {
      const { LocalNotifications } = await this.#plugin();
      const id = 2000 + Math.floor(Math.random() * 500);
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: title || 'Ближе',
            body: body || 'Тестовое уведомление',
            schedule: { at: new Date(Date.now() + 500) },
            extra: { screen: new URL(url, 'https://local').searchParams.get('screen') || 'today', tag },
            smallIcon: 'ic_stat_icon',
            iconColor: '#7657e8'
          }
        ]
      });
      return true;
    } catch (err) {
      console.warn('sendDebugNotification failed', err);
      return false;
    }
  }

  async sendPartnerAnsweredNotification() {
    return this.sendDebugNotification({
      title: '💌 Партнёр уже ответил',
      body: 'Можно открыть ответы.',
      url: '/?screen=today',
      tag: 'partner'
    });
  }

  async handleNotificationTap(handler) {
    try {
      const { LocalNotifications } = await this.#plugin();
      LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        const screen = event?.notification?.extra?.screen || 'today';
        handler?.({ screen, notification: event.notification });
      });
    } catch (err) {
      console.warn('notification tap listener failed', err);
    }
  }
}

const provider = runtime.isNative() ? new NativeNotificationProvider() : new WebNotificationProvider();

export const NotificationService = {
  requestPermission: (...a) => provider.requestPermission(...a),
  getPermissionStatus: (...a) => provider.getPermissionStatus(...a),
  scheduleDailyReminder: (...a) => provider.scheduleDailyReminder(...a),
  cancelDailyReminder: (...a) => provider.cancelDailyReminder(...a),
  sendDebugNotification: (...a) => provider.sendDebugNotification(...a),
  handleNotificationTap: (...a) => provider.handleNotificationTap?.(...a),
  sendPartnerAnsweredNotification: (...a) =>
    provider.sendPartnerAnsweredNotification?.(...a) ??
    provider.sendDebugNotification({
      title: '💌 Партнёр уже ответил',
      body: 'Можно открыть ответы.',
      url: '/?screen=today',
      tag: 'partner'
    }),
  backgroundPushConfigured: () => provider.backgroundPushConfigured?.() ?? false,
  getExistingPushSubscription: () => provider.getExistingPushSubscription?.() ?? null,
  subscribeBackgroundPush: () => provider.subscribeBackgroundPush?.(),
  providerName: () => (runtime.isNative() ? 'native-local' : 'web')
};
