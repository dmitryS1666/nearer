import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLinkPreviewRequest } from './linkPreview.js';
import { createPairService } from './pairs.js';
import { createPairStore } from './pairStore.js';
import { createPlusIntentService } from './plusIntent.js';
import { createPlusIntentStore } from './plusIntentStore.js';
import { createPlusMailer } from './plusMail.js';
import { createPilotStore } from './pilotStore.js';
import { createAdminAuth } from './adminAuth.js';
import { createPilotService } from './pilotService.js';
import { createPushDispatcher, pushStatus } from './pushDispatch.js';

function plusIntentStorePath() {
  if (process.env.PLUS_INTENT_STORE) return process.env.PLUS_INTENT_STORE;
  if (process.env.PAIR_STORE) return `${dirname(process.env.PAIR_STORE)}/plus-intents.json`;
  return fileURLToPath(new URL('../data/plus-intents.json', import.meta.url));
}

const plusService = createPlusIntentService({
  store: createPlusIntentStore({ filePath: plusIntentStorePath() }),
  mailer: createPlusMailer(),
  allowedOrigins: String(process.env.PLUS_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean)
});

const pairStore = createPairStore({
  filePath: process.env.PAIR_STORE || fileURLToPath(new URL('../data/pairs.json', import.meta.url))
});
const pairService = createPairService(pairStore);
const pilot = createPilotService({
  store: createPilotStore({
    filePath: process.env.PILOT_STORE || fileURLToPath(new URL('../data/pilot.json', import.meta.url)),
    retentionDays: Number(process.env.PILOT_RETENTION_DAYS || 180)
  }),
  auth: createAdminAuth({
    password: process.env.ADMIN_PASSWORD || '',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
    secureCookie: process.env.PILOT_COOKIE_SECURE === '1'
  }),
  pairStore,
  mailer: createPlusMailer(),
  dispatchPush: createPushDispatcher(),
  pushPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  pushInfo: pushStatus()
});

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';

function sendResult(res, result) {
  const headers = {
    'cache-control': 'no-store',
    ...(result.headers || {})
  };
  if (result.json != null) headers['content-type'] = 'application/json; charset=utf-8';
  res.writeHead(result.status, headers);
  if (result.json != null) res.end(JSON.stringify(result.json));
  else res.end(result.body || '');
}

function readBody(req, limit = 16_384) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end('{"status":"ok"}');
    return;
  }
  const path = req.url.split('?')[0];
  if (path === '/admin' || path === '/admin/' || path.startsWith('/api/admin') || path.startsWith('/api/pilot') || path === '/api/feedback' || path === '/api/app/version' || path.startsWith('/api/push')) {
    try {
      const raw = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req, 16_384);
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const result = await pilot.handle({
        method: req.method,
        path: req.url,
        rawBody: raw,
        headers: req.headers,
        ip
      });
      if (result) {
        sendResult(res, result);
        return;
      }
    } catch (error) {
      const status = error?.message === 'too_large' ? 413 : 400;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: error?.message === 'too_large' ? 'too_large' : 'invalid_json' }));
      return;
    }
  }
  if (path.startsWith('/api/pairs')) {
    try {
      const bodyLimit = path === '/api/pairs/sync' && req.method === 'PUT' ? 768_000 : 4_096;
      const raw = req.method === 'GET' || req.method === 'DELETE' ? '' : await readBody(req, bodyLimit);
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const result = pairService.handle({
        method: req.method,
        path,
        rawBody: raw,
        authorization: req.headers.authorization || '',
        ip
      });
      res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(result.json));
    } catch (error) {
      const status = error?.message === 'too_large' ? 413 : 400;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: error?.message === 'too_large' ? 'too_large' : 'invalid_json' }));
    }
    return;
  }
  if (path === '/api/plus/intent') {
    try {
      const raw = req.method === 'POST' ? await readBody(req, 2048) : '';
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const result = await plusService.handle({
        method: req.method,
        path,
        rawBody: raw,
        headers: req.headers,
        ip
      });
      res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(result.json));
    } catch (error) {
      const status = error?.message === 'too_large' ? 413 : 400;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: error?.message === 'too_large' ? 'too_large' : 'invalid_json' }));
    }
    return;
  }
  if (req.method === 'POST' && path === '/api/link-preview') {
    try {
      const raw = await readBody(req);
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const result = await handleLinkPreviewRequest(raw, { ip });
      res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(result.json));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
    }
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, host, () => {
  console.log(`nearer link listening on ${host}:${port}`);
});
