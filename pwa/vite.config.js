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
    const pairService = createPairService(createPairStore());

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
