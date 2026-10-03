import { config } from './config.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function backgroundPushConfigured() {
  return Boolean(config.push.vapidPublicKey);
}

export async function getExistingPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeBackgroundPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push API is not supported by this browser.');
  }
  if (!config.push.vapidPublicKey) {
    throw new Error('VAPID public key is not configured. Add it in config.js.');
  }
  if (!('Notification' in window)) throw new Error('Notifications API is not supported.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.push.vapidPublicKey)
    });
  }

  if (config.push.subscriptionEndpoint) {
    const response = await fetch(config.push.subscriptionEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    if (!response.ok) throw new Error(`Subscription endpoint returned ${response.status}.`);
  }

  return subscription;
}
