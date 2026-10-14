import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { createOfflineWorker } from '../../build/offline-worker'

function workerHarness() {
  const events = new Map<string, (event: unknown) => void>()
  const cache = {
    addAll: vi.fn(async (_requests: unknown[]) => {}),
    match: vi.fn(async () => 'cached asset'),
  }
  const cacheStorage = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ['signalshade-previous', 'signalshade-current', 'another-app']),
    delete: vi.fn(async () => true),
  }
  const self = {
    location: { origin: 'https://inertiaimpact.github.io' },
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(),
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      events.set(name, callback),
  }
  class CacheRequest {
    constructor(
      public url: string,
      public options: { cache: string },
    ) {}
  }
  runInNewContext(
    createOfflineWorker(
      ['/SignalShade/index.html', '/SignalShade/assets/app.js'],
      '/SignalShade/',
      'current',
    ),
    {
      self,
      caches: cacheStorage,
      Request: CacheRequest,
      URL,
      fetch: vi.fn(),
    },
  )
  return { events, cache, cacheStorage, self }
}

describe('offline application shell', () => {
  it('preloads fresh release files instead of the browser HTTP cache', async () => {
    const { events, cache } = workerHarness()
    let complete: Promise<void> | undefined
    events.get('install')!({
      waitUntil: (promise: Promise<void>) => {
        complete = promise
      },
    })
    await complete
    const requests = cache.addAll.mock.calls[0][0] as unknown as {
      url: string
      options: { cache: string }
    }[]
    expect(requests.map((r) => r.options.cache)).toEqual(['reload', 'reload'])
    expect(requests[0].url).toBe('/SignalShade/index.html')
  })
  it('never intercepts LAN calls, other projects, or non-asset requests', () => {
    const { events } = workerHarness(),
      respondWith = vi.fn()
    const request = (url: string, mode = 'cors') =>
      events.get('fetch')!({ request: { url, mode, method: 'GET' }, respondWith })
    request('http://192.168.1.20/config?action=set')
    request('https://inertiaimpact.github.io/another-project/index.html', 'navigate')
    request('https://inertiaimpact.github.io/SignalShade/unknown-data.json')
    expect(respondWith).not.toHaveBeenCalled()
    request('https://inertiaimpact.github.io/SignalShade/assets/app.js')
    expect(respondWith).toHaveBeenCalledTimes(1)
  })
  it('keeps other applications caches and waits for operator activation', async () => {
    const { events, cacheStorage, self } = workerHarness()
    let complete: Promise<void> | undefined
    events.get('activate')!({
      waitUntil: (promise: Promise<void>) => {
        complete = promise
      },
    })
    await complete
    expect(cacheStorage.delete).toHaveBeenCalledExactlyOnceWith('signalshade-previous')
    expect(self.skipWaiting).not.toHaveBeenCalled()
    events.get('message')!({ data: 'ACTIVATE_UPDATE' })
    expect(self.skipWaiting).toHaveBeenCalledOnce()
  })
})
