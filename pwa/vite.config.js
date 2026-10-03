import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
