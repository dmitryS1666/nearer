import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { handleLinkPreviewRequest } from './linkPreview.js';
import { createPairService } from './pairs.js';
import { createPairStore } from './pairStore.js';

const pairService = createPairService(createPairStore({
  filePath: process.env.PAIR_STORE || fileURLToPath(new URL('../data/pairs.json', import.meta.url))
}));

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';

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
  if (path.startsWith('/api/pairs')) {
    try {
      const raw = req.method === 'GET' || req.method === 'DELETE' ? '' : await readBody(req, 1024);
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
    } catch {
      res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
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
