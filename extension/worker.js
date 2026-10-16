import {
  trustedPage,
  deviceOrigin,
  operation,
  descriptors,
  validateWrite,
  scanOrigins,
} from './policy.js'
import { activeFsDescriptors } from './fs-parameters.js'
import { fs1Descriptors, fs1ReadIds, isFs1Identity, fs1ReadValue } from './legacy-fs1.js'

const queues = new Map()
const discovered = new Map()
const legacyReads = new Map()
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
    Math.max(
      1,
      Math.min(
        /^(desc.json|descriptors\?)/.test(path) ? 20000 : 3000,
        (m.deadline ?? Date.now() + 6000) - Date.now(),
      ),
    ),
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
    const response = await fetch(`${origin}/${path === 'device-info' ? '' : path}`, {
      method: login ? 'POST' : 'GET',
      headers,
      body: login ? new URLSearchParams({ password_provided: m.password }) : undefined,
      credentials: login || m.authenticated === true ? 'include' : 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Device returned HTTP ${response.status} at ${path}`)
    const reader = response.body.getReader()
    // FS descriptor tables can exceed 4 MiB. Stay below Chrome's 64 MiB message ceiling.
    const limit = /^(desc.json|descriptors\?)/.test(path) ? 32 * 1024 * 1024 : 4 * 1024 * 1024
    let size = 0,
      result = ''
    const decoder = new TextDecoder()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error(`Device response at ${path} exceeds ${limit / 1024 / 1024} MiB`)
      }
      result += decoder.decode(chunk.value, { stream: true })
    }
    result += decoder.decode()
    if (path === 'device-info') {
      const title = (result.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
      const model = result.match(
        /\bFS[- ]?HDR\b|\bFS1[- ]X\b|\bFS[124]\b|\bHELO(?:[- ]?PLUS)?\b|\bKi ?Pro(?: (?:Ultra|GO|Rack|Mini))?/i,
      )?.[0]
      return { title, model, aja: /\bAJA\b/i.test(result), status: response.status }
    }
    return JSON.parse(result)
  } catch (e) {
    if (e.name === 'AbortError')
      throw new Error(
        path.includes('action=set')
          ? 'Device request timed out; command outcome may be unknown'
          : 'Device request timed out',
      )
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
  if (m.type === 'openExtensions') {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
    return { opened: true }
  }
  if (m.type === 'scan-status' || m.type === 'scan-permission') {
    const origins = scanOrigins(m.start, m.end)
    const key = `scan:${sender.tab.id}`
    const scan = (await chrome.storage.session.get(key))[key]
    if (m.type === 'scan-status')
      return {
        allowed:
          !!scan &&
          scan.expires > Date.now() &&
          origins.every((o) => scan.origins.includes(o)) &&
          (await chrome.permissions.contains({ origins: origins.map((o) => `${o}/*`) })),
      }
    const token = crypto.randomUUID()
    await chrome.storage.session.set({
      [`approval:${sender.tab.id}`]: { origins, token, created: Date.now(), scan: true },
    })
    return {
      approvalUrl: chrome.runtime.getURL(`approve.html?tab=${sender.tab.id}&token=${token}`),
    }
  }
  const origin = deviceOrigin(m.origin)
  const hostPattern = `${new URL(origin).protocol}//${new URL(origin).hostname}/*`
  if (m.type === 'permission') {
    const key = `approval:${sender.tab.id}`
    const token = crypto.randomUUID()
    await chrome.storage.session.set({ [key]: { origin, token, created: Date.now() } })
    return {
      approvalUrl: chrome.runtime.getURL(`approve.html?tab=${sender.tab.id}&token=${token}`),
    }
  }
  const grants = (await chrome.storage.local.get('origins')).origins ?? []
  const allowed =
    grants.includes(origin) && (await chrome.permissions.contains({ origins: [hostPattern] }))
  if (m.type === 'status') return { allowed }
  const scan = (await chrome.storage.session.get(`scan:${sender.tab.id}`))[`scan:${sender.tab.id}`]
  const scanAllowed =
    !!scan &&
    scan.expires > Date.now() &&
    scan.origins.includes(origin) &&
    (await chrome.permissions.contains({ origins: [hostPattern] }))
  if (m.type === 'adopt') {
    if (allowed) return { allowed: true }
    const list = discovered.get(`${sender.tab.id}:${sender.documentId}:${origin}`)
    if (!scanAllowed || !list?.length)
      throw new Error('Device requires approval or descriptor identification before adding')
    if (
      list === fs1Descriptors &&
      legacyReads.get(`${sender.tab.id}:${sender.documentId}:${origin}`)?.size !== fs1ReadIds.length
    )
      throw new Error('Read the FS1 status and ProcAmp controls before adding')
    await chrome.storage.local.set({ origins: [...new Set([...grants, origin])] })
    return { allowed: true }
  }
  if (!allowed && !scanAllowed)
    throw new Error('Device access required. Click Allow device in the SignalShade Connect panel.')
  if (m.type !== 'request') throw new Error('Unknown bridge operation')
  const op = operation(m.path)
  if (!allowed && (op.kind === 'write' || op.kind === 'login'))
    throw new Error('Scan access is read-only; approve or add the device first')
  if (inflight >= 32) throw new Error('Connect is busy; retry the read later')
  inflight++
  try {
    return await serialized(origin, async () => {
      if (
        !Number.isFinite(m.deadline) ||
        m.deadline < Date.now() ||
        m.deadline > Date.now() + (op.kind === 'descriptors' ? 22000 : 10000)
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
        let list = discovered.get(`${owner}:${origin}`)
        if (!list) {
          // MV3 suspends idle workers. Recover metadata through reads, never replay a write.
          let raw
          try {
            raw = await fetchJson(origin, 'desc.json', m)
          } catch (e) {
            if (!/HTTP (404|410)\b/.test(e.message)) throw e
            try {
              raw = await fetchJson(origin, 'descriptors?paramid=*', m)
            } catch (error) {
              if (
                !/HTTP (404|410)\b/.test(error.message) ||
                !m.path.startsWith('json?') ||
                !isFs1Identity(await fetchJson(origin, 'device-info', m))
              )
                throw error
              for (const id of fs1ReadIds) {
                if (
                  !fs1ReadValue(
                    await fetchJson(origin, `json?action=get&paramid=${id}&configid=0&alt=json`, m),
                    id,
                  )
                )
                  throw new Error('FS1 status read failed')
              }
              legacyReads.set(`${owner}:${origin}`, new Set(fs1ReadIds))
              raw = fs1Descriptors
            }
          }
          list = raw === fs1Descriptors ? fs1Descriptors : activeFsDescriptors(descriptors(raw))
          discovered.set(`${owner}:${origin}`, list)
        }
        validateWrite(op, list)
        if (
          list === fs1Descriptors &&
          legacyReads.get(`${owner}:${origin}`)?.size !== fs1ReadIds.length
        )
          throw new Error('Read the FS1 status and ProcAmp controls before adjusting')
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
      if (m.deadline <= Date.now())
        throw new Error('Request expired before dispatch; read device state')
      const result = await fetchJson(origin, m.path, m)
      const ownerKey = `${sender.tab.id}:${sender.documentId}:${origin}`
      if (op.kind === 'identity' && isFs1Identity(result)) discovered.set(ownerKey, fs1Descriptors)
      if (
        op.kind === 'read' &&
        m.path.startsWith('json?') &&
        discovered.get(ownerKey) === fs1Descriptors &&
        fs1ReadValue(result, op.id)
      ) {
        const read = legacyReads.get(ownerKey) ?? new Set()
        read.add(op.id)
        legacyReads.set(ownerKey, read)
      }
      if (op.kind === 'descriptors')
        discovered.set(
          `${sender.tab.id}:${sender.documentId}:${origin}`,
          activeFsDescriptors(descriptors(result)),
        )
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
  chrome.storage.session.remove(`scan:${tabId}`)
  for (const key of discovered.keys()) if (key.startsWith(`${tabId}:`)) discovered.delete(key)
  for (const key of legacyReads.keys()) if (key.startsWith(`${tabId}:`)) legacyReads.delete(key)
})
