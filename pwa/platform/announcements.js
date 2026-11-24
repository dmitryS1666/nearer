import { registerPlugin } from '@capacitor/core';
import { apiEndpoint } from './apiEndpoint.js';
import { platformFetch } from './nativeHttp.js';
import { runtime } from './runtime.js';

const ApkUpdate = registerPlugin('ApkUpdate');

export function installAndroidUpdate(remote) {
  return ApkUpdate.downloadAndInstall({
    url: remote.downloadUrl,
    sha256: String(remote.sha256 || '').toLowerCase(),
    versionCode: Number(remote.versionCode)
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function postRegistration(body) {
  await platformFetch(apiEndpoint('/api/push/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function registerAnnouncementPush({ installId, announcements, technical, versionName } = {}) {
  if (!installId) return { ok: false, reason: 'no_install' };
  if (runtime.isAndroid()) return registerAndroidPush({ installId, announcements, technical, versionName });
  return registerWebPush({ installId, announcements, technical, versionName });
}

async function registerWebPush({ installId, announcements, technical, versionName }) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { ok: false, reason: 'unsupported' };
  const keyResponse = await platformFetch(apiEndpoint('/api/push/vapid'), { headers: { accept: 'application/json' } });
  if (!keyResponse.ok) return { ok: false, reason: 'not_configured' };
  const { publicKey } = await keyResponse.json();
  if (!publicKey) return { ok: false, reason: 'not_configured' };
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }
  const json = subscription.toJSON();
  await postRegistration({
    platform: 'pwa',
    installId,
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh || '',
    auth: json.keys?.auth || '',
    announcements: announcements === true,
    technical: technical !== false,
    versionName
  });
  return { ok: true };
}

async function registerAndroidPush(details) {
  let PushNotifications;
  try {
    const specifier = '@capacitor/push-notifications';
    ({ PushNotifications } = await import(/* @vite-ignore */ specifier));
  } catch {
    return { ok: false, reason: 'firebase_plugin_missing' };
  }
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return { ok: false, reason: 'denied' };
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: 'firebase_not_configured' }), 8000);
    PushNotifications.addListener('registration', async (token) => {
      clearTimeout(timer);
      try {
        await postRegistration({
          platform: 'android',
          token: token.value,
          installId: details.installId,
          announcements: details.announcements === true,
          technical: details.technical !== false,
          versionName: details.versionName
        });
        resolve({ ok: true });
      } catch {
        resolve({ ok: false, reason: 'register_failed' });
      }
    });
    PushNotifications.addListener('registrationError', () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'firebase_not_configured' });
    });
    PushNotifications.register().catch(() => {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'firebase_not_configured' });
    });
  });
}
