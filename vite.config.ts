import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'

function offlineShell() {
  let base = '/'
  return {
    name: 'signalshade-offline-shell',
    configResolved(config: { base: string }) {
      base = config.base
    },
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      const files = ['index.html', 'favicon.svg', ...Object.keys(bundle)].map(
        (file) => `${base}${file}`,
      )
      const version = createHash('sha256').update(JSON.stringify(bundle)).digest('hex').slice(0, 12)
      const worker = `
const CACHE = 'signalshade-${version}';
const FILES = ${JSON.stringify([...new Set(files)])};
const BASE = ${JSON.stringify(base)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('signalshade-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (!FILES.includes(url.pathname) && event.request.mode !== 'navigate') return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const match = await cache.match(event.request.mode === 'navigate' ? BASE + 'index.html' : event.request);
    return match || fetch(event.request);
  }));
});`
      ;(this as unknown as { emitFile: (file: object) => void }).emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: worker,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  base: process.env.GITHUB_ACTIONS ? '/SignalShade/' : '/',
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
