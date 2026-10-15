import { afterEach, expect, it, vi } from 'vitest'
import { discoverDevice, scanDevices, type DiscoveryResult } from './discovery'
import { ipv4Range } from './aja'
afterEach(() => vi.unstubAllGlobals())
it('keeps a legacy FS1 visible even when no descriptor endpoint is available', async () => {
  const fetcher = vi.fn(
    async (_url: string) =>
      new Response('<html><title>AJA FS1</title><body>FS1 configuration</body></html>'),
  )
  vi.stubGlobal('fetch', fetcher)
  const result = await discoverDevice('10.215.20.225', new AbortController().signal)
  expect(result).toMatchObject({ status: 'found', model: 'FS1' })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe('http://10.215.20.225/')
})
it('scans every address instead of returning only already approved device hosts', async () => {
  const addresses = ipv4Range('10.215.20.1', '10.215.20.255')
  const seen: string[] = [],
    results: DiscoveryResult[] = [],
    progress: number[] = []
  let concurrent = 0,
    max = 0
  await scanDevices(
    addresses,
    new AbortController().signal,
    (r) => results.push(r),
    (n) => progress.push(n),
    async (address) => {
      concurrent++
      max = Math.max(max, concurrent)
      seen.push(address)
      await Promise.resolve()
      concurrent--
      return {
        address,
        status: 'found',
        model: address.endsWith('.225') ? 'FS1' : 'FS2',
        detail: 'Found',
      }
    },
  )
  expect(new Set(seen).size).toBe(254)
  expect(results).toHaveLength(254)
  expect(progress.at(-1)).toBe(254)
  expect(max).toBeLessThanOrEqual(8)
})
it('stops scheduling addresses after cancellation and retains completed results', async () => {
  const abort = new AbortController(),
    results: DiscoveryResult[] = []
  let started = 0
  await scanDevices(
    ipv4Range('10.1.1.1', '10.1.1.254'),
    abort.signal,
    (r) => results.push(r),
    () => {},
    async (address) => {
      started++
      if (started === 10) abort.abort()
      await Promise.resolve()
      return { address, status: 'found', detail: 'Found' }
    },
  )
  expect(started).toBeLessThan(254)
  expect(results.length).toBeGreaterThan(0)
})
