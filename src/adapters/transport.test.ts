import { afterEach, expect, it, vi } from 'vitest'
import { AjaTransport, ensureDeviceAccess, requestAddDeviceAccess } from './transport'

afterEach(() => vi.unstubAllGlobals())
function extension(reply: (type: string) => { ok: boolean; data?: unknown; error?: string }) {
  const windowMock = Object.assign(new EventTarget(), {
    location: { origin: 'https://inertiaimpact.github.io' },
    postMessage: vi.fn((message: { type: string; id: string }) => {
      queueMicrotask(() => {
        const event = Object.assign(new Event('message'), {
          source: windowMock,
          origin: windowMock.location.origin,
          data: {
            source: 'signalshade-connect',
            protocol: 1,
            id: message.id,
            ...reply(message.type),
          },
        })
        windowMock.dispatchEvent(event)
      })
    }),
  })
  vi.stubGlobal('window', windowMock)
  return windowMock
}
it('uses direct fetch when the extension is unavailable', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetcher)
  await new AjaTransport().fetch('http://10.1.1.1', 'desc.json', {})
  expect(fetcher).toHaveBeenCalledWith('http://10.1.1.1/desc.json', { redirect: 'error' })
})
it('routes reads through Connect without making a page fetch', async () => {
  extension((type) => ({
    ok: true,
    data:
      type === 'hello'
        ? { version: '0.1.0', protocol: 1 }
        : { name: 'eParamID_ProductID', value: 'HELO-PLUS' },
  }))
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const result = await new AjaTransport().fetch(
    'http://10.1.1.1',
    'config?action=get&paramid=eParamID_ProductID',
    {},
  )
  expect(await result.json()).toMatchObject({ value: 'HELO-PLUS' })
  expect(fetcher).not.toHaveBeenCalled()
})
it('never retries a failed extension write through direct fetch', async () => {
  const windowMock = extension((type) =>
    type === 'hello'
      ? { ok: true, data: { version: '0.1.0', protocol: 1 } }
      : { ok: false, error: 'Unknown command outcome' },
  )
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    new AjaTransport().fetch(
      'http://10.1.1.1',
      'config?action=set&paramid=eParamID_ReplicatorCommand&value=1&configid=0',
      {},
    ),
  ).rejects.toThrow('Unknown command outcome')
  expect(windowMock.postMessage).toHaveBeenCalledTimes(2)
  expect(fetcher).not.toHaveBeenCalled()
})
it('does not open approval for a normal device HTTP error', async () => {
  const w = extension((type) =>
    type === 'hello'
      ? { ok: true, data: { version: '0.3.0', protocol: 1 } }
      : { ok: false, error: 'Device returned HTTP 404' },
  )
  const help = vi.fn()
  w.addEventListener('signalshade-connection-help', help)
  await expect(new AjaTransport().fetch('http://10.1.1.1', 'desc.json', {})).rejects.toThrow(
    'HTTP 404',
  )
  expect(help).not.toHaveBeenCalled()
  expect(w.postMessage.mock.calls.map(([m]) => m.type)).toEqual(['hello', 'request'])
})
it('skips all approval UI for previously allowed devices', async () => {
  const w = extension((type) => ({
    ok: true,
    data: type === 'hello' ? { version: '0.3.0', protocol: 1 } : { allowed: true },
  }))
  await ensureDeviceAccess('http://10.1.1.1')
  expect(w.postMessage.mock.calls.map(([m]) => m.type)).toEqual(['hello', 'status'])
})
it('resumes after the native Chrome prompt and respects a denial', async () => {
  let approved = false
  let granted = false
  const w = extension((type) => {
    if (type === 'hello') return { ok: true, data: { version: '0.4.3', protocol: 1 } }
    if (type === 'status') return { ok: true, data: { allowed: granted } }
    if (type === 'request-host-access') {
      granted = approved
      return { ok: true, data: { approved } }
    }
    throw new Error(`Unexpected bridge request: ${type}`)
  })
  const open = vi.fn()
  w.addEventListener('signalshade-approval-open', open)
  await expect(ensureDeviceAccess('http://10.1.1.1')).rejects.toThrow('not granted')
  approved = true
  await ensureDeviceAccess('http://10.1.1.1')
  expect(open).not.toHaveBeenCalled()
  expect(w.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
    'hello',
    'status',
    'request-host-access',
    'hello',
    'status',
    'request-host-access',
    'status',
  ])
})
it('dispatches manual Add approval before probing and never opens the embedded prompt', async () => {
  let outcome: { fallback?: boolean; approved?: boolean } = { fallback: true }
  const w = extension((type) => {
    if (type === 'request-host-access') return { ok: true, data: outcome }
    if (type === 'hello') return { ok: true, data: { version: '0.4.3', protocol: 1 } }
    if (type === 'status') return { ok: true, data: { allowed: true } }
    throw new Error(`Unexpected bridge request: ${type}`)
  })
  const open = vi.fn()
  w.addEventListener('signalshade-approval-open', open)
  const controller = new AbortController()
  const first = requestAddDeviceAccess('http://10.1.1.1', controller.signal)
  expect(w.postMessage.mock.calls.map(([m]) => m.type)).toEqual(['request-host-access', 'hello'])
  await expect(first).rejects.toThrow('Click Add device to try again')
  outcome = { approved: true }
  await requestAddDeviceAccess('http://10.1.1.1', controller.signal)
  expect(open).not.toHaveBeenCalled()
  expect(w.postMessage.mock.calls.at(-1)?.[0].type).toBe('status')
})
it('returns the embedded approval and resumes automatically after a verified grant', async () => {
  let granted = false
  const w = extension((type) => ({
    ok: true,
    data:
      type === 'hello'
        ? { version: '0.4.3', protocol: 1 }
        : type === 'status'
          ? { allowed: granted }
          : type === 'request-host-access'
            ? { fallback: true }
            : { approvalUrl: 'chrome-extension://test/approve.html?token=test-token' },
  }))
  const open = vi.fn(() => {
    granted = true
    queueMicrotask(() =>
      w.dispatchEvent(
        Object.assign(new Event('message'), {
          origin: 'chrome-extension://test',
          data: { source: 'signalshade-connect-approval', token: 'test-token', approved: true },
        }),
      ),
    )
  })
  w.addEventListener('signalshade-approval-open', open)
  await ensureDeviceAccess('http://10.1.1.1')
  expect(open).toHaveBeenCalledTimes(1)
  expect(w.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
    'hello',
    'status',
    'request-host-access',
    'permission',
    'status',
  ])
})
