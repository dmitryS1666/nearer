import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));

/** Dev/preview only — production `vite build` must not import Node server modules. */
function linkPreviewPlugin() {
  const attach = async (server) => {
    const { handleLinkPreviewRequest } = await import('../server/linkPreview.js');
    const { createPairService } = await import('../server/pairs.js');
    const { createPairStore } = await import('../server/pairStore.js');
    const { createPlusIntentService } = await import('../server/plusIntent.js');
    const { createPlusIntentStore } = await import('../server/plusIntentStore.js');
    const { createPlusMailer } = await import('../server/plusMail.js');
    const plusService = createPlusIntentService({
      store: createPlusIntentStore(),
      mailer: createPlusMailer(),
      allowedOrigins: String(process.env.PLUS_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean)
    });
    // Local/dev E2E shares one loopback IP for all Playwright contexts — raise sync budget.
    const pairService = createPairService(createPairStore(), {
      limits: { create: 40, join: 40, sync: 400, windowMs: 10 * 60 * 1000 }
    });

    server.middlewares.use((req, res, next) => {
      const path = String(req.url || '').split('?')[0];
      if (!path.startsWith('/api/pairs')) return next();
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('error', () => next());
      req.on('end', () => {
        const result = pairService.handle({
          method: req.method,
          path,
          rawBody: Buffer.concat(chunks).toString('utf8'),
          authorization: req.headers.authorization || '',
          ip: req.socket?.remoteAddress || ''
        });
        res.statusCode = result.status;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify(result.json));
      });
    });
    server.middlewares.use((req, res, next) => {
      const path = String(req.url || '').split('?')[0];
      if (path !== '/api/plus/intent') return next();
      const chunks = [];
      let size = 0;
      let rejected = false;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2048) {
          rejected = true;
          res.statusCode = 413;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify({ error: 'too_large' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('error', () => next());
      req.on('end', async () => {
        if (rejected || res.writableEnded) return;
        try {
          const result = await plusService.handle({
            method: req.method,
            path,
            rawBody: Buffer.concat(chunks).toString('utf8'),
            headers: req.headers,
            ip: req.socket?.remoteAddress || ''
          });
          res.statusCode = result.status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify(result.json));
        } catch {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'invalid_json' }));
        }
      });
    });
    server.middlewares.use('/api/link-preview', (req, res, next) => {
      if (req.method !== 'POST') return next();
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('error', () => next());
      req.on('end', async () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const result = await handleLinkPreviewRequest(raw, { ip: req.socket?.remoteAddress || '' });
          res.statusCode = result.status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify(result.json));
        } catch {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'invalid_json' }));
        }
      });
    });
  };
  return {
    name: 'nearer-link-preview',
    configureServer: attach,
    configurePreviewServer: attach
  };
}

export default defineConfig({
  plugins: [linkPreviewPlugin()],
  root: rootDir,
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'www',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: resolve(rootDir, 'index.html')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  }
});
