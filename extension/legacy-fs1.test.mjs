import test from 'node:test'
import assert from 'node:assert/strict'
import { fs1Descriptors, fs1ReadIds } from './legacy-fs1.js'
import { validateWrite, operation } from './policy.js'
test('legacy FS1 accepts only five native ProcAmp controls with their actual ranges and steps', () => {
  assert.deepEqual(operation('json?action=get&paramid=eParamID_SysName&configid=0&alt=json'), {
    kind: 'read',
    id: 'eParamID_SysName',
  })
  assert.throws(() => operation('json?action=set&paramid=eParamID_SysName&value=1&configid=0'))
  validateWrite(
    operation('json?action=set&paramid=eParamID_ProcAmpBlackYCOffset&value=5&configid=0'),
    fs1Descriptors,
  )
  for (const [id, value] of [
    ['eParamID_ProcAmpBlackYCGain', 151],
    ['eParamID_ProcAmpBlackYCOffset', 3],
    ['eParamID_ProcAmpHue', 181],
    ['eParamID_ProcAmpEnable', 2],
  ])
    assert.throws(() => validateWrite({ id, value }, fs1Descriptors))
  assert.throws(() =>
    operation('json?action=set&paramid=eParamID_VideoInputSelect&value=1&configid=0'),
  )
})
test('worker identifies legacy FS1, requires live reads, and recovers its mapping after suspension without replaying writes', async () => {
  const oldChrome = globalThis.chrome,
    oldFetch = globalThis.fetch,
    origin = 'http://10.0.0.2'
  let listener
  const store = (initial = {}) => {
    const data = { ...initial }
    return {
      get: async (k) => (k === null ? { ...data } : { [k]: data[k] }),
      set: async (p) => Object.assign(data, p),
      remove: async () => {},
    }
  }
  const writes = []
  globalThis.chrome = {
    runtime: {
      id: 'test',
      getManifest: () => ({ version: '0.4.0' }),
      onMessage: { addListener: (fn) => (listener = fn) },
    },
    tabs: { onRemoved: { addListener: () => {} } },
    permissions: { contains: async () => true },
    storage: { local: store({ origins: [origin] }), session: store() },
  }
  globalThis.fetch = async (url) => {
    const u = new URL(url),
      id = u.searchParams.get('paramid')
    if (u.pathname === '/') return new Response('<title>AJA Video - FS1 Admin: Main</title>')
    if (u.pathname !== '/json') return new Response('', { status: 404 })
    if (u.searchParams.get('action') === 'set') writes.push(url)
    return new Response(
      JSON.stringify({
        name: id,
        value: fs1Descriptors.find((d) => d.param_id === id)?.default_value ?? 0,
      }),
    )
  }
  const send = (path) =>
    new Promise((resolve) =>
      listener(
        {
          protocol: 1,
          id: crypto.randomUUID(),
          type: 'request',
          origin,
          path,
          deadline: Date.now() + 4000,
        },
        {
          id: 'test',
          frameId: 0,
          tab: { id: 1 },
          documentId: 'doc',
          url: 'https://inertiaimpact.github.io/SignalShade/',
        },
        resolve,
      ),
    )
  const write = 'json?action=set&paramid=eParamID_ProcAmpBlackYCGain&value=101&configid=0'
  try {
    await import(`./worker.js?legacy=initial-${Date.now()}`)
    assert.equal((await send('device-info')).ok, true)
    assert.equal((await send(write)).ok, false)
    assert.equal(writes.length, 0)
    for (const id of fs1ReadIds)
      assert.equal((await send(`json?action=get&paramid=${id}&configid=0&alt=json`)).ok, true)
    assert.equal(
      (await send('json?action=get&paramid=eParamID_SysName&configid=0&alt=json')).ok,
      true,
    )
    assert.equal((await send(write)).ok, true)
    assert.equal(writes.length, 1)
    await import(`./worker.js?legacy=restart-${Date.now()}`)
    assert.equal((await send(write)).ok, true)
    assert.equal(writes.length, 2)
    assert.equal(
      (await send('json?action=set&paramid=eParamID_ProcAmpHue&value=181&configid=0')).ok,
      false,
    )
    assert.equal(writes.length, 2)
  } finally {
    globalThis.chrome = oldChrome
    globalThis.fetch = oldFetch
  }
})
