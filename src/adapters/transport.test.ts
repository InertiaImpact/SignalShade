import { afterEach, expect, it, vi } from 'vitest'
import { AjaTransport, ensureDeviceAccess } from './transport'

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
      ? { ok: true, data: { version: '0.2.0', protocol: 1 } }
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
    data: type === 'hello' ? { version: '0.2.0', protocol: 1 } : { allowed: true },
  }))
  await ensureDeviceAccess('http://10.1.1.1')
  expect(w.postMessage.mock.calls.map(([m]) => m.type)).toEqual(['hello', 'status'])
})
it('returns the embedded approval and resumes automatically after a verified grant', async () => {
  let granted = false
  const w = extension((type) => ({
    ok: true,
    data:
      type === 'hello'
        ? { version: '0.2.0', protocol: 1 }
        : type === 'status'
          ? { allowed: granted }
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
    'permission',
    'status',
  ])
})
