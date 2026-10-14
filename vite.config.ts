import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { createOfflineWorker } from './build/offline-worker.ts'

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
      const version = createHash('sha256')
        .update(JSON.stringify(bundle))
        .update(createOfflineWorker(files, base, 'version-placeholder'))
        .digest('hex')
        .slice(0, 12)
      const worker = createOfflineWorker(files, base, version)
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
