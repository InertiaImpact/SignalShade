import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AjaAdapter,
  extractDescriptors,
  ipv4Range,
  mapDescriptor,
  normalizeAddress,
  readValue,
} from './aja'

const gain = {
  param_id: 'eParamID_ProcAmpGain_Vid1',
  param_name: 'Proc Amp Gain',
  min_value: 0,
  max_value: 1500,
  adjust_by: 10,
  default_value: 1000,
  scale_by: 0.001,
  offset_by: 0,
}
afterEach(() => vi.unstubAllGlobals())
describe('AJA browser transport', () => {
  it('falls back to the documented legacy descriptor endpoint after a 404 and requests JSON values', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const u = new URL(url)
      if (u.pathname === '/desc.json') return { ok: false, status: 404, json: async () => ({}) }
      if (u.pathname === '/descriptors')
        return {
          ok: true,
          json: async () => [{ param_id: 'eParamID_ProductID', param_name: 'Product ID' }],
        }
      return { ok: true, json: async () => ({ name: 'eParamID_ProductID', value: 'FS1' }) }
    })
    vi.stubGlobal('fetch', fetcher)
    const adapter = new AjaAdapter('10.0.0.2')
    const result = await adapter.probe()
    expect(result.model).toBe('FS1')
    expect(result.rawDescriptorCount).toBe(1)
    expect(fetcher).toHaveBeenCalledWith('http://10.0.0.2/descriptors?paramid=*', expect.anything())
    expect(fetcher.mock.calls.some(([url]) => url.includes('alt=json'))).toBe(true)
    expect(fetcher.mock.calls.every(([url]) => !url.includes('action=set'))).toBe(true)
    adapter.dispose()
  })
  it('reports missing endpoints without suggesting repeated device approval', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetcher)
    const adapter = new AjaAdapter('10.0.0.2')
    const result = await adapter.probe()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.checks[0].detail).toContain('approval cannot fix a missing endpoint')
    adapter.dispose()
  })
  it('accepts private IPv4 with ports and rejects remote destinations or URL payloads', () => {
    expect(normalizeAddress('192.168.1.20')).toBe('http://192.168.1.20')
    expect(normalizeAddress('https://10.0.0.2:8443')).toBe('https://10.0.0.2:8443')
    for (const address of [
      'https://example.com',
      'http://8.8.8.8',
      'http://192.168.1.1/config?action=set',
      'file:///etc/passwd',
      'http://user:pass@10.0.0.2',
      'javascript:alert(1)',
    ])
      expect(() => normalizeAddress(address)).toThrow()
  })
  it('limits discovery to an explicit bounded /24 range', () => {
    expect(ipv4Range('10.0.0.10', '10.0.0.12')).toEqual(['10.0.0.10', '10.0.0.11', '10.0.0.12'])
    expect(() => ipv4Range('10.0.0.10', '10.0.1.12')).toThrow()
    expect(() => ipv4Range('10.0.0.12', '10.0.0.10')).toThrow()
  })
  it('maps recognized color descriptors only and preserves native numeric representation', () => {
    expect(mapDescriptor(gain)).toMatchObject({
      id: 'gain',
      min: 0,
      max: 1500,
      neutral: 1000,
      step: 10,
      unit: 'native',
      nativeId: gain.param_id,
    })
    expect(mapDescriptor({ ...gain, param_name: 'Network address' })).toBeUndefined()
    expect(mapDescriptor({ ...gain, min_value: undefined })).toBeUndefined()
    expect(mapDescriptor({ ...gain, adjust_by: 0 })).toBeUndefined()
    expect(mapDescriptor({ ...gain, param_id: 'unsafe&action=set' })).toBeUndefined()
  })
  it('extracts nested descriptors and accepts only explicit readable numeric responses', () => {
    expect(extractDescriptors({ parameters: { colors: [gain] } })).toEqual([gain])
    expect(readValue([{ paramid: gain.param_id, value: '1000' }], gain.param_id)).toBe(1000)
    expect(
      readValue({ paramid: '2097225226', name: gain.param_id, value: '1000' }, gain.param_id),
    ).toBe(1000)
    expect(() => readValue({ paramid: 'another', value: 1 }, gain.param_id)).toThrow()
    expect(() => readValue({ value: '' }, gain.param_id)).toThrow()
    expect(() => readValue({ value: 'NaN' }, gain.param_id)).toThrow()
  })
  it('uses CORS and uncached GETs without leaking credentials by default', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: 1 }) })
    vi.stubGlobal('fetch', fetcher)
    const adapter = new AjaAdapter('10.0.0.2')
    await adapter.readParameter(gain.param_id)
    expect(fetcher).toHaveBeenCalledWith(
      `http://10.0.0.2/config?action=get&paramid=${gain.param_id}`,
      expect.objectContaining({
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        targetAddressSpace: 'local',
      }),
    )
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined()
    adapter.dispose()
  })
  it('turns unreadable requests into failed diagnostics without sending writes', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    const adapter = new AjaAdapter('10.0.0.2')
    const result = await adapter.probe()
    expect(result.channels).toEqual([])
    expect(result.checks[0].status).toBe('fail')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('http://10.0.0.2/desc.json')
    adapter.dispose()
  })
  it('rejects writes without context metadata before making a network request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const adapter = new AjaAdapter('10.0.0.2')
    const d = mapDescriptor(gain)!
    await expect(
      adapter.write({ id: 'a', descriptors: [d], context: '' } as never, d, 1010),
    ).rejects.toThrow('Source context')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
