type Reply = { ok: boolean; data?: unknown; error?: string }
export class BridgeAccessError extends Error {}
export const connectRelease =
  'https://github.com/InertiaImpact/SignalShade/releases/latest/download/signalshade-connect.zip'
export const connectInstructions =
  'https://github.com/InertiaImpact/SignalShade/blob/main/extension/README.md'

export function bridgeMessage(
  type: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
  timeout = 8500,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Connect unavailable'))
      return
    }
    const id = crypto.randomUUID()
    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () =>
      finish(new DOMException('Request aborted; command outcome may be unknown', 'AbortError'))
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.source !== 'signalshade-connect' ||
        event.data.protocol !== 1 ||
        event.data.id !== id
      )
        return
      const reply = event.data as Reply
      finish(
        reply.ok
          ? undefined
          : reply.error?.startsWith('Device access required')
            ? new BridgeAccessError(reply.error)
            : new Error(reply.error || 'Connect request failed'),
        reply.data,
      )
    }
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            type === 'hello'
              ? 'Connect not detected'
              : 'Connect did not respond; reconnect before further commands',
          ),
        ),
      timeout,
    )
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    window.addEventListener('message', receive)
    window.postMessage(
      {
        source: 'signalshade-site',
        protocol: 1,
        type,
        id,
        ...payload,
        deadline: Date.now() + timeout,
      },
      window.location.origin,
    )
  })
}
export async function detectConnect(): Promise<string | undefined> {
  try {
    const reply = (await bridgeMessage('hello', {}, undefined, 1000)) as {
      version: string
      protocol: number
    }
    if (reply.protocol === 1) return reply.version
  } catch {
    /* Direct transport remains available. */
  }
}
function notify(origin: string) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('signalshade-connection-help', { detail: origin }))
}

let pendingApproval: { origin: string; promise: Promise<void> } | undefined
/** Called only by explicit Connect actions. Polls never open approval UI. */
export async function ensureDeviceAccess(
  origin: string,
  scan?: { start: string; end: string },
): Promise<void> {
  const version = await detectConnect()
  if (!version) {
    if (scan)
      throw new Error('Install SignalShade Connect to scan the network with one range approval.')
    return
  }
  if (scan && Number(version.split('.')[1]) < 3)
    throw new Error(
      'Update SignalShade Connect to v0.3.0 or newer to scan a range, then reload the extension and SignalShade.',
    )
  if (Number(version.split('.')[0]) === 0 && Number(version.split('.')[1]) < 3)
    throw new Error(
      'Update SignalShade Connect to v0.3.0 or newer, reload the extension, then reload SignalShade.',
    )
  const payload = scan ?? { origin }
  const statusType = scan ? 'scan-status' : 'status'
  const status = (await bridgeMessage(statusType, payload)) as { allowed: boolean }
  if (status.allowed) return
  if (pendingApproval) {
    if (pendingApproval.origin === origin) return pendingApproval.promise
    throw new Error('Finish the current device approval first')
  }
  const promise = (async () => {
    const reply = (await bridgeMessage(scan ? 'scan-permission' : 'permission', payload)) as {
      approvalUrl?: string
    }
    if (!reply.approvalUrl)
      throw new Error(
        'Update SignalShade Connect to v0.2.0 or newer, reload it, and reload SignalShade.',
      )
    const url = new URL(reply.approvalUrl)
    if (url.protocol !== 'chrome-extension:' || url.pathname !== '/approve.html')
      throw new Error('Invalid approval page')
    const token = url.searchParams.get('token')
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        window.removeEventListener('message', receive)
        window.removeEventListener('signalshade-approval-cancel', cancel)
        window.dispatchEvent(new CustomEvent('signalshade-approval-close'))
        if (error) reject(error)
        else resolve()
      }
      const cancel = () => finish(new Error('Device approval cancelled'))
      const receive = (e: MessageEvent) => {
        if (
          e.origin !== `chrome-extension://${url.host}` ||
          e.data?.source !== 'signalshade-connect-approval' ||
          e.data.token !== token
        )
          return
        finish(e.data.approved === true ? undefined : new Error('Device access was not granted'))
      }
      const timer = setTimeout(
        () => finish(new Error('Device approval expired. Click Connect to try again.')),
        120000,
      )
      window.addEventListener('message', receive)
      window.addEventListener('signalshade-approval-cancel', cancel)
      window.dispatchEvent(
        new CustomEvent('signalshade-approval-open', {
          detail: { origin, url: reply.approvalUrl },
        }),
      )
    })
    const verified = (await bridgeMessage(statusType, payload)) as { allowed: boolean }
    if (!verified.allowed) throw new Error('Device permission was not saved')
  })()
  pendingApproval = { origin, promise }
  try {
    await promise
  } finally {
    pendingApproval = undefined
  }
}

/** One route per adapter instance. An uncertain write is never retried on another route. */
export class AjaTransport {
  private route?: Promise<boolean>
  async fetch(origin: string, path: string, options: RequestInit): Promise<Response> {
    this.route ??= detectConnect().then(Boolean)
    if (await this.route) {
      try {
        const headers = new Headers(options.headers)
        const data = await bridgeMessage(
          'request',
          {
            origin,
            path,
            authorization: headers.get('Authorization') ?? undefined,
            authenticated: options.credentials === 'include',
            password:
              path === 'authenticator/login' && options.body instanceof URLSearchParams
                ? options.body.get('password_provided')
                : undefined,
          },
          options.signal ?? undefined,
          /^(desc.json|descriptors\?)/.test(path) ? 21000 : 4000,
        )
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        if (error instanceof BridgeAccessError) notify(origin)
        throw error
      }
    }
    try {
      const response = await fetch(`${origin}/${path === 'device-info' ? '' : path}`, {
        ...options,
        redirect: 'error',
      })
      if (path !== 'device-info' || !response.ok) return response
      const text = (await response.text()).slice(0, 4 * 1024 * 1024)
      return new Response(
        JSON.stringify({
          title: (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 180),
          model: text.match(
            /\bFS[- ]?HDR\b|\bFS1[- ]X\b|\bFS[124]\b|\bHELO(?:[- ]?PLUS)?\b|\bKi ?Pro(?: (?:Ultra|GO|Rack|Mini))?/i,
          )?.[0],
          aja: /\bAJA\b/i.test(text),
          status: response.status,
        }),
      )
    } catch (error) {
      if (error instanceof TypeError) notify(origin)
      throw error
    }
  }
}
