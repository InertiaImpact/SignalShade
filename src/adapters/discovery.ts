import { AjaAdapter, message, normalizeAddress } from './aja'

export interface DiscoveryResult {
  address: string
  model?: string
  title?: string
  name?: string
  status: 'found' | 'unrecognized' | 'auth' | 'blocked' | 'unreachable'
  detail: string
}
/** Optional identity metadata must never hide an otherwise discovered device. */
export async function readDeviceName(
  adapter: AjaAdapter,
  model: string | undefined,
  signal: AbortSignal,
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timer = setTimeout(abort, 1800)
  const legacy = /^FS1$/i.test(model ?? '')
  const ids = legacy
    ? ['eParamID_SysName']
    : /^FS/i.test(model ?? '')
      ? ['eParamID_SysName', 'eParamID_SystemName']
      : ['eParamID_SystemName', 'eParamID_SysName']
  try {
    for (const id of ids) {
      if (controller.signal.aborted) break
      try {
        const response = await adapter.request(
          `${legacy ? 'json' : 'config'}?${new URLSearchParams({ action: 'get', paramid: id, configid: '0', alt: 'json' })}`,
          controller.signal,
        )
        const entries = Array.isArray(response) ? response : [response]
        const match = entries.find(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            [entry.name, entry.param_id, entry.paramid].includes(id),
        )
        if (typeof match?.value !== 'string') continue
        const name = match.value
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100)
        if (name) return name
      } catch {
        // Older firmware, authentication and timeouts can leave the optional name unavailable.
      }
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
/** Read-only identification. A missing shading API never makes a reachable unit disappear. */
export async function discoverDevice(
  address: string,
  signal: AbortSignal,
): Promise<DiscoveryResult> {
  const origin = normalizeAddress(address)
  const adapter = new AjaAdapter(origin)
  const finish = (value: DiscoveryResult) => {
    adapter.dispose()
    return value
  }
  const result: DiscoveryResult = { address: origin, status: 'unreachable', detail: 'No response' }
  try {
    const info = (await adapter.request('device-info', signal)) as {
      title?: string
      model?: string
      aja?: boolean
    }
    result.title = info.title
    result.model = info.model
    // A model-like token (for example a server named FS1) is not vendor identification.
    // Require AJA branding together with a model, or explicit AJA branding in the title.
    if (info.aja === true && (info.model || /\bAJA\b/i.test(info.title ?? '')))
      return finish({
        ...result,
        name: await readDeviceName(adapter, info.model, signal),
        status: 'found',
        detail: 'Reachable · identify controls when adding',
      })
    result.status = 'unrecognized'
    result.detail = 'HTTP device responded; AJA identity not verified'
  } catch (e) {
    const text = message(e)
    if (/access required|permission|revoked/i.test(text))
      return finish({ ...result, status: 'blocked', detail: text })
    if (/HTTP (401|403)/.test(text))
      return finish({ ...result, status: 'auth', detail: 'Device authentication required' })
    if (!/HTTP \d+/.test(text)) return finish({ ...result, detail: text })
    result.status = 'unrecognized'
    result.detail = text
  }
  return finish(result)
}

export async function scanDevices(
  addresses: string[],
  signal: AbortSignal,
  onResult: (result: DiscoveryResult) => void,
  onProgress: (completed: number) => void,
  inspect = discoverDevice,
) {
  let cursor = 0,
    completed = 0
  await Promise.all(
    Array.from({ length: Math.min(8, addresses.length) }, async () => {
      while (cursor < addresses.length && !signal.aborted) {
        const address = addresses[cursor++]
        const controller = new AbortController()
        const abort = () => controller.abort()
        signal.addEventListener('abort', abort, { once: true })
        const timer = setTimeout(abort, 4500)
        try {
          const result = await inspect(address, controller.signal)
          if (!signal.aborted) onResult(result)
        } catch (e) {
          if (!signal.aborted)
            onResult({
              address: normalizeAddress(address),
              status: 'unreachable',
              detail: message(e),
            })
        } finally {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          if (!signal.aborted) onProgress(++completed)
        }
      }
    }),
  )
}
