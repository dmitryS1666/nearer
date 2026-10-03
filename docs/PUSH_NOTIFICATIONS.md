# Push notifications в PWA

## Что уже есть в prototype

`sw.js` обрабатывает:

- `push`;
- `notificationclick`;
- переход по deep link после клика;
- локальное `ServiceWorkerRegistration.showNotification()` для UI/debug теста.

В Settings есть feature detection:

- Notifications API;
- Service Worker;
- PushManager;
- текущее permission state.

## Что было в исходном master prompt

Отдельный notification scope уже задан:

1. Daily question;
2. Partner answered;
3. Reveal;
4. Streak risk;
5. настройки каждого типа уведомлений.

## Что нужно добавить для реального background Web Push

Frontend:

```js
const registration = await navigator.serviceWorker.ready;
const subscription = await registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
});

await api.savePushSubscription(subscription);
```

Backend хранит subscription по device/user и отправляет стандартный Web Push payload.

Рекомендуемая production схема для проекта:

```
PWA
  │ PushSubscription
  ▼
Supabase/Postgres
  │
  ├─ scheduled Edge Function: daily question
  ├─ DB event/function: partner answered
  └─ DB event/function: reveal
             │
             ▼
       Web Push sender
             │
             ▼
         Push Service
             │
             ▼
         Service Worker
             │
             ▼
         Notification
```

## iOS / iPadOS

Web Push поддерживается для web apps, добавленных на Home Screen, начиная с iOS/iPadOS 16.4. Разрешение должно запрашиваться после явного user interaction.

Нельзя ожидать одинакового UX от обычной вкладки Safari и установленной Home Screen PWA.

## Android / desktop

Современные Chromium-браузеры поддерживают стандартный Push API + Service Worker + Notifications API.

## Почему local-only не может доставить настоящий scheduled push

Закрытый браузер/PWA не выполняет произвольные JS timers по расписанию. Нужен внешний sender, который отправит сообщение в push service. Поэтому полностью serverless-to-us вариант всё равно может использовать managed backend: Supabase Edge Functions/cron или отдельный push provider.

## Что НЕ отправлять в push payload

Для privacy-first Couple приложения не отправляйте:

- текст ответа;
- recovery keys;
- E2EE keys;
- private notes.

Payload должен содержать только событие и route, например:

```json
{
  "type": "partner_answered",
  "title": "Партнёр уже ответил 💌",
  "body": "Теперь твоя очередь.",
  "url": "/?screen=today"
}
```
