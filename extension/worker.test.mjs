import test from 'node:test'
import assert from 'node:assert/strict'

test('worker enforces sender, grants, discovery, duplicate suppression, and write ownership', async () => {
  const originalChrome = globalThis.chrome,
    originalFetch = globalThis.fetch
  let listener,
    permitted = true
  const storage = (initial) => {
    const data = { ...initial }
    return {
      get: async (key) => (key === null ? { ...data } : { [key]: data[key] }),
      set: async (patch) => Object.assign(data, patch),
      remove: async (keys) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]
      },
    }
  }
  const origin = 'http://10.1.1.1'
  const calls = []
  globalThis.chrome = {
    runtime: {
      id: 'test',
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => `chrome-extension://test/${path}`,
      onMessage: { addListener: (fn) => (listener = fn) },
    },
    storage: { local: storage({ origins: [origin] }), session: storage({}) },
    permissions: { contains: async () => permitted },
    tabs: { onRemoved: { addListener: () => {} } },
  }
  const list = [
    {
      param_id: 'eParamID_ReplicatorCommand',
      enum_values: [
        { value: 1, text: 'Record Command' },
        { value: 2, text: 'Stop Recording Command' },
      ],
    },
  ]
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify(url.endsWith('desc.json') ? list : { value: '1' }))
  }
  try {
    await import(`./worker.js?test=${Date.now()}`)
    const sender = {
      id: 'test',
      frameId: 0,
      tab: { id: 1 },
      documentId: 'doc1',
      url: 'https://inertiaimpact.github.io/SignalShade/',
    }
    const send = (patch = {}, from = sender) =>
      new Promise((resolve) =>
        listener(
          {
            protocol: 1,
            id: crypto.randomUUID(),
            type: 'request',
            origin,
            path: 'desc.json',
            deadline: Date.now() + 3000,
            ...patch,
          },
          from,
          resolve,
        ),
      )
    assert.equal((await send({}, { ...sender, url: 'https://evil.example/' })).ok, false)
    assert.equal((await send({}, { ...sender, frameId: 2 })).ok, false)
    assert.equal((await send({ origin: 'http://127.0.0.1' })).ok, false)
    assert.equal(calls.length, 0)
    const write = {
      path: 'config?action=set&paramid=eParamID_ReplicatorCommand&value=1&configid=0',
    }
    // A restarted worker can recover descriptors and validate before the first write.
    assert.equal((await send(write)).ok, true)
    assert.equal(calls[0].url, `${origin}/desc.json`)
    assert.equal((await send()).ok, true)
    const id = crypto.randomUUID()
    assert.equal((await send({ ...write, id })).ok, true)
    assert.equal((await send({ ...write, id })).ok, false)
    assert.equal((await send({ ...write, deadline: Date.now() - 1 })).ok, false)
    assert.equal((await send(write, { ...sender, tab: { id: 2 }, documentId: 'doc2' })).ok, false)
    assert.equal(calls.filter((c) => c.url.includes('action=set')).length, 2)
    const approval = await send({ type: 'permission' })
    assert.equal(approval.ok, true)
    assert.match(
      approval.data.approvalUrl,
      /^chrome-extension:\/\/test\/approve.html\?tab=1&token=/,
    )
    // No windows API is provided by this fixture: approval is returned for embedding, never opened as a popup.
    assert.equal(
      calls.every((c) => c.options.redirect === 'error'),
      true,
    )
    permitted = false
    assert.equal((await send()).ok, false)
    permitted = true
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    assert.match((await send()).error, /could not reach/)
  } finally {
    globalThis.chrome = originalChrome
    globalThis.fetch = originalFetch
  }
})
