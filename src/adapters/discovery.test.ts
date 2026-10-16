import { afterEach, expect, it, vi } from 'vitest'
import { discoverDevice, scanDevices, type DiscoveryResult } from './discovery'
import { ipv4Range } from './aja'
afterEach(() => vi.unstubAllGlobals())
it.each([
  '<html><title>Network switch</title><body>Management interface</body></html>',
  '<html><title>FS1 file server</title><body>Storage administration</body></html>',
  '<html><title>Equipment inventory</title><body>AJA is one of our suppliers</body></html>',
])('does not classify unrelated web pages as AJA devices: %s', async (html) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(html)),
  )
  const result = await discoverDevice('10.0.0.2', new AbortController().signal)
  expect(result.status).toBe('unrecognized')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('recognizes an explicitly branded AJA web interface without inventing its model', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<title>AJA Video Systems · Device interface</title>')),
  )
  const result = await discoverDevice('10.0.0.2', new AbortController().signal)
  expect(result).toMatchObject({ status: 'found' })
  expect(result.model).toBeUndefined()
})
it('keeps a legacy FS1 visible even when no descriptor endpoint is available', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/')
      ? new Response('<html><title>AJA FS1</title><body>FS1 configuration</body></html>')
      : new Response('Not found', { status: 404 }),
  )
  vi.stubGlobal('fetch', fetcher)
  const result = await discoverDevice('10.215.20.225', new AbortController().signal)
  expect(result).toMatchObject({ status: 'found', model: 'FS1' })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[0][0]).toBe('http://10.215.20.225/')
})
it.each([
  ['FS2', 'eParamID_SysName', '/config'],
  ['HELO Plus', 'eParamID_SystemName', '/config'],
  ['Ki Pro Ultra', 'eParamID_SystemName', '/config'],
  ['FS1', 'eParamID_SysName', '/json'],
])(
  'reads the configured %s name using its native read endpoint',
  async (model, parameter, path) => {
    const fetcher = vi.fn(async (url: string) => {
      const u = new URL(url)
      if (u.pathname === '/') return new Response(`<title>AJA ${model}</title>`)
      expect(u.pathname).toBe(path)
      expect(u.searchParams.get('action')).toBe('get')
      expect(u.searchParams.get('paramid')).toBe(parameter)
      return new Response(
        JSON.stringify({ paramid: '1234', name: parameter, value: '  Truck A  Main  ' }),
      )
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await discoverDevice('10.0.0.2', new AbortController().signal)
    expect(result).toMatchObject({ status: 'found', name: 'Truck A Main', model })
    expect(fetcher).toHaveBeenCalledTimes(2)
  },
)
it('tries the alternate name field without accepting a response for another parameter', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url),
        id = u.searchParams.get('paramid')
      if (u.pathname === '/') return new Response('<title>AJA FS2</title>')
      return new Response(
        JSON.stringify(
          id === 'eParamID_SysName'
            ? { name: 'eParamID_ProductID', value: 'Wrong name' }
            : [{ name: id, value: 'Shader rack' }],
        ),
      )
    }),
  )
  expect(await discoverDevice('10.0.0.2', new AbortController().signal)).toMatchObject({
    status: 'found',
    name: 'Shader rack',
  })
})
it('keeps devices visible when the optional name is blank, blocked or malformed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url)
      if (u.pathname === '/') return new Response('<title>AJA HELO Plus</title>')
      if (u.searchParams.get('paramid') === 'eParamID_SystemName')
        return new Response(JSON.stringify({ name: 'eParamID_SystemName', value: ' \n ' }))
      return new Response('Login required', { status: 401 })
    }),
  )
  const result = await discoverDevice('10.0.0.2', new AbortController().signal)
  expect(result.status).toBe('found')
  expect(result.name).toBeUndefined()
})
it('times out optional name reads without dropping the identified device', async () => {
  vi.useFakeTimers()
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (new URL(url).pathname === '/') return new Response('<title>AJA FS2</title>')
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        })
      }),
    )
    const read = discoverDevice('10.0.0.2', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1801)
    expect(await read).toMatchObject({ status: 'found', model: 'FS2' })
  } finally {
    vi.useRealTimers()
  }
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
