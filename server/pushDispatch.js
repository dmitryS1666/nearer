import { createSign } from 'node:crypto';
import { sendWebPush } from './webPush.js';

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function vapidFromEnv(env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKeyPem = String(env.VAPID_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!publicKey || !privateKeyPem) return null;
  return { publicKey, privateKeyPem, subject: env.VAPID_SUBJECT || 'mailto:ops@localhost' };
}

function fcmFromEnv(env) {
  const clientEmail = String(env.FCM_CLIENT_EMAIL || '').trim();
  const privateKey = String(env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const projectId = String(env.FCM_PROJECT_ID || '').trim();
  if (!clientEmail || !privateKey || !projectId) return null;
  return { clientEmail, privateKey, projectId };
}

async function fcmAccessToken(account, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const assertion = `${header}.${claim}.${b64url(signer.sign(account.privateKey))}`;
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error('fcm_auth_failed');
  const json = await response.json();
  return json.access_token;
}

export function pushStatus(env = process.env) {
  return {
    webPush: Boolean(vapidFromEnv(env)),
    fcm: Boolean(fcmFromEnv(env)),
    note: 'Принято провайдером — это не прочтение.'
  };
}

export function createPushDispatcher({ env = process.env, fetchImpl = fetch } = {}) {
  return async function dispatchPush({ title, body, screen, kind, targets }) {
    const vapid = vapidFromEnv(env);
    const fcm = fcmFromEnv(env);
    let accepted = 0;
    let failed = 0;
    const invalidIds = [];
    const payload = { title, body, url: `./?screen=${screen || 'today'}`, kind, tag: `nearer-${kind}` };
    for (const target of targets) {
      try {
        if (target.platform === 'pwa') {
          if (!vapid) throw new Error('not_configured');
          await sendWebPush({
            subscription: target,
            payload,
            vapid,
            subject: vapid.subject,
            fetchImpl
          });
        } else if (target.platform === 'android') {
          if (!fcm) throw new Error('not_configured');
          const token = await fcmAccessToken(fcm, fetchImpl);
          const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              message: {
                token: target.token,
                notification: { title, body },
                data: { url: payload.url, kind: kind || 'product' },
                android: { priority: 'high' }
              }
            })
          });
          if (response.status === 404) {
            const error = new Error('gone');
            error.status = 404;
            throw error;
          }
          if (!response.ok) throw new Error('fcm_failed');
        } else {
          throw new Error('unknown_platform');
        }
        accepted += 1;
      } catch (error) {
        failed += 1;
        if (error.status === 404 || error.status === 410) invalidIds.push(target.id);
      }
    }
    const status = accepted === 0 && failed > 0 && !vapid && !fcm ? 'not_configured' : 'sent';
    return { accepted, failed, invalidIds, status };
  };
}
