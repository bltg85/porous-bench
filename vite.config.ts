import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createShare, readShare, type ShareStore } from './api/_share.js';

/** Short share links in development: the handlers Vercel runs (api/), with setups kept in memory. */
function shareApi(): Plugin {
  const kept = new Map<string, string>();
  const store: ShareStore = { get: async (id) => kept.get(id) ?? null, add: async (id, data) => void kept.set(id, data) };
  return {
    name: 'bench-share-api',
    configureServer(server) {
      server.middlewares.use('/api/share', async (req, res) => {
        // Node's request, read as the stream it is (the config has no Node types).
        const incoming = req as unknown as AsyncIterable<Uint8Array<ArrayBuffer>> & { method?: string; originalUrl?: string };
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const post = incoming.method === 'POST';
        const request = new Request(new URL(incoming.originalUrl ?? '/', 'http://localhost'), { method: incoming.method, body: post ? new Blob(chunks) : undefined });
        const response = await (post ? createShare(request, store) : readShare(request, store));
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), shareApi()],
  server: {
    port: 5199,
    // The Resident relay doesn't accept calls from browser pages, so Bench reaches it through its own
    // origin: /relay/… here, and the same rewrite in vercel.json in production.
    proxy: {
      '/relay': { target: 'https://resident.inanimate.tech', changeOrigin: true, rewrite: (p) => p.replace(/^\/relay/, '') },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
