import { trustedPage, deviceOrigin, operation, descriptors, validateWrite } from './policy.js'

const queues = new Map()
const discovered = new Map()
let inflight = 0
function serialized(origin, task) {
  const previous = queues.get(origin) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  queues.set(origin, next)
  next
    .finally(() => {
      if (queues.get(origin) === next) queues.delete(origin)
    })
    .catch(() => {})
  return next
}
async function fetchJson(origin, path, m = {}) {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(6000, (m.deadline ?? Date.now() + 6000) - Date.now())),
  )
  try {
    const login = path === 'authenticator/login'
    const headers = {}
    if (m.authorization !== undefined) {
      if (
        typeof m.authorization !== 'string' ||
        !/^Basic [A-Za-z0-9+/=]{1,4096}$/.test(m.authorization)
      )
        throw new Error('Invalid authentication')
      headers.Authorization = m.authorization
    }
    if (login && (typeof m.password !== 'string' || m.password.length > 4096))
      throw new Error('Invalid password')
    const response = await fetch(`${origin}/${path}`, {
      method: login ? 'POST' : 'GET',
      headers,
      body: login ? new URLSearchParams({ password_provided: m.password }) : undefined,
      credentials: login || m.authenticated === true ? 'include' : 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Device returned HTTP ${response.status}`)
    const reader = response.body.getReader()
    let size = 0,
      result = ''
    const decoder = new TextDecoder()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 4 * 1024 * 1024) {
        await reader.cancel()
        throw new Error('Device response exceeds 4 MB')
      }
      result += decoder.decode(chunk.value, { stream: true })
    }
    result += decoder.decode()
    return JSON.parse(result)
  } catch (e) {
    if (e.name === 'AbortError')
      throw new Error('Device request timed out; command outcome may be unknown')
    if (e instanceof TypeError)
      throw new Error(
        'Connect could not reach the device. Check network, device access, and browser policy.',
      )
    throw e
  } finally {
    clearTimeout(timer)
  }
}
async function handle(m, sender) {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    !sender.tab ||
    !trustedPage(sender.url) ||
    m?.protocol !== 1 ||
    typeof m.id !== 'string' ||
    !/^[A-Za-z0-9-]{1,100}$/.test(m.id)
  )
    throw new Error('Untrusted bridge request')
  if (m.type === 'hello') return { version: chrome.runtime.getManifest().version, protocol: 1 }
  const origin = deviceOrigin(m.origin)
  const hostPattern = `${new URL(origin).protocol}//${new URL(origin).hostname}/*`
  if (m.type === 'permission') {
    const key = `approval:${sender.tab.id}`
    const old = (await chrome.storage.session.get(key))[key]
    if (old && Date.now() - old.created < 60000)
      throw new Error('A device approval is already open')
    const token = crypto.randomUUID()
    await chrome.storage.session.set({ [key]: { origin, token, created: Date.now() } })
    await chrome.windows.create({
      url: `approve.html?tab=${sender.tab.id}&token=${token}`,
      type: 'popup',
      width: 440,
      height: 360,
    })
    return { approvalOpened: true }
  }
  const grants = (await chrome.storage.local.get('origins')).origins ?? []
  const allowed =
    grants.includes(origin) && (await chrome.permissions.contains({ origins: [hostPattern] }))
  if (m.type === 'status') return { allowed }
  if (!allowed)
    throw new Error('Device access required. Click Allow device in the SignalShade Connect panel.')
  if (m.type !== 'request') throw new Error('Unknown bridge operation')
  const op = operation(m.path)
  if (inflight >= 16) throw new Error('Connect is busy; retry the read later')
  inflight++
  try {
    return await serialized(origin, async () => {
      if (
        !Number.isFinite(m.deadline) ||
        m.deadline < Date.now() ||
        m.deadline > Date.now() + 10000
      )
        throw new Error('Request expired; reconnect and read device state')
      if (!(await chrome.permissions.contains({ origins: [hostPattern] })))
        throw new Error('Device access revoked')
      // Persist before dispatch: a terminated worker must not replay an uncertain write.
      if (op.kind === 'write') {
        const key = `write:${origin}`
        const seenKey = `command:${m.id}`
        if ((await chrome.storage.session.get(seenKey))[seenKey])
          throw new Error('Duplicate command suppressed; read device state before continuing')
        const old = (await chrome.storage.session.get(key))[key]
        const owner = `${sender.tab.id}:${sender.documentId}`
        if (old?.id === m.id)
          throw new Error('Duplicate command suppressed; read device state before continuing')
        if (old && old.owner !== owner && Date.now() - old.at < 30000)
          throw new Error('Another SignalShade tab is controlling this device')
        const list = discovered.get(`${owner}:${origin}`)
        if (!list)
          throw new Error('Connect restarted. Reconnect the device before changing controls.')
        validateWrite(op, list)
        // Expired IDs cannot be dispatched: the original deadline is validated above.
        const saved = await chrome.storage.session.get(null)
        const expired = Object.keys(saved).filter(
          (k) => k.startsWith('command:') && saved[k] < Date.now(),
        )
        if (expired.length) await chrome.storage.session.remove(expired)
        await chrome.storage.session.set({
          [key]: { id: m.id, owner, at: Date.now() },
          [seenKey]: Date.now() + 30000,
        })
      }
      const result = await fetchJson(origin, m.path, m)
      if (op.kind === 'descriptors')
        discovered.set(`${sender.tab.id}:${sender.documentId}:${origin}`, descriptors(result))
      // Login responses never expose cookies or other authentication metadata.
      return op.kind === 'login'
        ? { login: result?.login === 'success' ? 'success' : 'failed' }
        : result
    })
  } finally {
    inflight--
  }
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  handle(m, sender).then(
    (data) => respond({ ok: true, data }),
    (e) => respond({ ok: false, error: e.message || 'Connect request failed' }),
  )
  return true
})
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`approval:${tabId}`)
  for (const key of discovered.keys()) if (key.startsWith(`${tabId}:`)) discovered.delete(key)
})
