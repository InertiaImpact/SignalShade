import { diagnostics } from '../core/diagnostics'
import { mediaMetric, groupMedia, isMediaDescriptor } from './media'
export { mediaMetric, groupMedia } from './media'
import { extractDescriptors, normalizeAddress } from '../adapters/aja'
import { AjaTransport } from '../adapters/transport'
import type {
  RecorderAdapter,
  RecorderConfig,
  RecorderMedia,
  RecorderSnapshot,
  TransportState,
} from './types'

type Raw = Record<string, unknown>
// AJA replies may identify a parameter by numeric paramid AND symbolic name.
export function parameterResponse(input: unknown, id: string, allowEmpty = false): Raw {
  const entries = Array.isArray(input) ? input : [input]
  const match = entries.find(
    (v) => v && typeof v === 'object' && (v.name === id || v.param_id === id || v.paramid === id),
  )
  if (
    !match ||
    !('value' in match) ||
    match.value === null ||
    (!allowEmpty && String(match.value).trim() === '')
  )
    throw new Error(`Unreadable parameter: ${id}`)
  return match
}
export function transportState(value: unknown, helo: boolean): TransportState {
  const n = Number(value)
  if (n === 1) return 'idle'
  if (n === 2) return 'recording'
  if (helo) return n === 3 || n === 4 ? 'error' : 'unknown'
  if (n === 15) return 'paused'
  if (n >= 16 && n <= 19) return 'error'
  if (n >= 3 && n <= 14) return 'playback'
  return 'unknown'
}
export class AjaRecorderAdapter implements RecorderAdapter {
  private transport = new AjaTransport()
  private address: string
  private controllers = new Set<AbortController>()
  private closed = false
  private descriptors?: Raw[]
  private media: RecorderMedia[] = []
  private mediaFields: RecorderMedia[] = []
  private firmware = ''
  private control = false
  private authenticated = false
  private helo: boolean
  private stateId: string
  private commandId: string
  constructor(
    config: RecorderConfig,
    private password = '',
  ) {
    this.address = normalizeAddress(config.address)
    this.helo = config.model.startsWith('HELO')
    this.stateId = this.helo ? 'eParamID_ReplicatorRecordState' : 'eParamID_TransportState'
    this.commandId = this.helo ? 'eParamID_ReplicatorCommand' : 'eParamID_TransportCommand'
  }
  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (this.closed) throw new Error('Connection closed')
    const controller = new AbortController()
    this.controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), path === 'desc.json' ? 22000 : 4500)
    try {
      const options: RequestInit & { targetAddressSpace?: string } = {
        ...init,
        mode: 'cors',
        credentials: this.password ? 'include' : 'omit',
        cache: 'no-store',
        signal: controller.signal,
        targetAddressSpace: 'local',
        redirect: 'error',
      }
      let response: Response
      try {
        response = await this.transport.fetch(this.address, path, options)
      } catch (error) {
        if (controller.signal.aborted)
          throw new Error(this.closed ? 'Connection closed' : `Recorder request timed out: ${path}`)
        if (error instanceof TypeError)
          throw new Error(
            `Browser could not read recorder response: ${path}. Check the browser Console for CORS or local-network restrictions. Opening the device directly does not verify cross-origin access.`,
          )
        throw error
      }
      if (!response.ok)
        throw new Error(`Recorder HTTP ${response.status}; reconnect/check authentication`)
      return await response.json()
    } finally {
      clearTimeout(timeout)
      this.controllers.delete(controller)
    }
  }
  private async get(id: string, allowEmpty = false) {
    return parameterResponse(
      await this.request(`config?${new URLSearchParams({ action: 'get', paramid: id })}`),
      id,
      allowEmpty,
    )
  }
  private async discover() {
    if (this.password && !this.authenticated) {
      const result = (await this.request('authenticator/login', {
        method: 'POST',
        body: new URLSearchParams({ password_provided: this.password }),
      })) as Raw
      if (result.login !== 'success') throw new Error('Recorder login failed')
      this.authenticated = true
    }
    const descriptors = extractDescriptors(await this.request('desc.json'))
    if (!descriptors.some((d) => d.param_id === this.stateId))
      throw new Error('Selected recorder model does not expose the expected transport API')
    for (const d of descriptors.filter(
      (d) =>
        d.param_id === 'eParamID_CurrentlyRunningImageVersion' ||
        /^(firmware( version)?|software version)$/i.test(String(d.param_name)),
    )) {
      try {
        this.firmware += ` ${String((await this.get(String(d.param_id))).value)}`
      } catch {
        /* Optional firmware metadata must not block transport controls. */
      }
    }
    const command = descriptors.find((d) => d.param_id === this.commandId)
    const enums = Array.isArray(command?.enum_values) ? (command.enum_values as Raw[]) : []
    const accepts = (value: number) =>
      (!enums.length || enums.some((e) => Number(e.value) === value)) &&
      (command?.min_value === undefined || value >= Number(command.min_value)) &&
      (command?.max_value === undefined || value <= Number(command.max_value))
    this.control = !!command && accepts(this.helo ? 1 : 3) && accepts(this.helo ? 2 : 4)
    this.descriptors = [...new Map(descriptors.map((d) => [String(d.param_id), d])).values()]
    diagnostics.report(this.address, {
      type: this.helo ? 'HELO recorder' : 'Ki Pro recorder',
      descriptors: this.descriptors,
      firmware: this.firmware,
    })
  }
  async read(includeMedia: boolean): Promise<RecorderSnapshot> {
    if (!this.descriptors) await this.discover()
    const state = transportState((await this.get(this.stateId)).value, this.helo)
    const warnings: string[] = []
    let duration: string | undefined
    if (this.descriptors!.some((d) => d.param_id === 'eParamID_RecordingDuration')) {
      try {
        const value = String((await this.get('eParamID_RecordingDuration')).value)
        if (/^\d+:\d{2}:\d{2}([:;]\d{2})?$/.test(value)) duration = value
      } catch {
        warnings.push('Duration unavailable')
      }
    }
    if (includeMedia) {
      const candidates = this.descriptors!.filter(isMediaDescriptor)
      const next: RecorderMedia[] = []
      // Small batches bound requests per appliance and keep failed optional metrics independent.
      for (let i = 0; i < candidates.length; i += 4) {
        await Promise.all(
          candidates.slice(i, i + 4).map(async (d) => {
            const id = String(d.param_id)
            try {
              next.push(mediaMetric(d, await this.get(id, true), Date.now()))
            } catch {
              next.push({
                id,
                label: String(d.param_name),
                status: 'Unknown',
                active: /^eParamID_CurrentMedia/.test(id),
                updatedAt: 0,
                warnings: [],
                metrics: [],
              })
            }
          }),
        )
      }
      this.mediaFields = next
      this.media = groupMedia(next.sort((a, b) => a.label.localeCompare(b.label)))
    }
    // Read transport again after potentially slow media requests; never timestamp an old state as fresh.
    const confirmed = includeMedia
      ? transportState((await this.get(this.stateId)).value, this.helo)
      : state
    const mediaMode = this.mediaFields.find((m) => m.id === 'eParamID_MediaState')
    const transfer = mediaMode && /data|transfer/i.test(mediaMode.status)
    if (transfer) warnings.push('Media is in data transfer mode')
    return {
      state: confirmed,
      updatedAt: Date.now(),
      duration: confirmed === state ? duration : undefined,
      durationKind: duration ? 'clip' : undefined,
      media: this.media,
      warnings,
      firmware: this.firmware.trim() || undefined,
      scope: this.helo ? 'Recording only' : 'Device-wide · all enabled recording channels',
      canControl: this.control && !transfer,
      enabled: false,
      controlReason: this.control
        ? undefined
        : 'Record/Stop commands are not available in the device API',
    }
  }
  async command(action: 'record' | 'stop') {
    if (!this.control) throw new Error('Record/Stop commands are not available in the device API')
    // Only these two values can be written. No combined stream, media or configuration commands.
    const value = action === 'record' ? (this.helo ? 1 : 3) : this.helo ? 2 : 4
    await this.request(
      `config?${new URLSearchParams({ action: 'set', paramid: this.commandId, value: String(value), configid: '0' })}`,
    )
  }
  dispose() {
    this.closed = true
    this.password = ''
    this.controllers.forEach((c) => c.abort())
    this.controllers.clear()
  }
}
