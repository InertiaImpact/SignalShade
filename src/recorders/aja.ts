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
export function parameterResponse(input: unknown, id: string): Raw {
  const entries = Array.isArray(input) ? input : [input]
  const match = entries.find(
    (v) => v && typeof v === 'object' && (v.name === id || v.param_id === id || v.paramid === id),
  )
  if (!match || !('value' in match) || match.value === null || String(match.value).trim() === '')
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
function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || String(value).trim() === '') return
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
export function mediaMetric(descriptor: Raw, response: Raw, now: number): RecorderMedia {
  const label = String(descriptor.param_name ?? descriptor.param_id)
  const text = String(response.value_name ?? response.value)
  const units = String(descriptor.units ?? '').trim()
  const n = finite(response.value)
  const media: RecorderMedia = {
    id: String(descriptor.param_id),
    label,
    status: 'Reported',
    active: /current|primary/i.test(label),
    updatedAt: now,
    metrics: [{ label, value: `${text}${units ? ` ${units}` : ''}` }],
    warnings: [],
  }
  if (descriptor.param_id === 'eParamID_CurrentMediaAvailable' && n !== undefined && n <= 100)
    media.freePercent = n
  // Only normalize explicit units with no undiscovered scaling. Preserve other values verbatim.
  const scale = descriptor.scale_by === undefined ? 1 : Number(descriptor.scale_by)
  const offset = descriptor.offset_by === undefined ? 0 : Number(descriptor.offset_by)
  if (n !== undefined && scale === 1 && offset === 0) {
    const free = /available|free|remaining/i.test(label)
    const bytes = (
      {
        bytes: 1,
        B: 1,
        KB: 1e3,
        MB: 1e6,
        GB: 1e9,
        TB: 1e12,
        KiB: 1024,
        MiB: 1024 ** 2,
        GiB: 1024 ** 3,
      } as Record<string, number>
    )[units]
    if (free && bytes) media.freeBytes = n * bytes
    if (/total|capacity/i.test(label) && bytes) media.totalBytes = n * bytes
    if (free && units === '%' && n <= 100) media.freePercent = n
    const seconds = ({ s: 1, sec: 1, seconds: 1, min: 60, minutes: 60 } as Record<string, number>)[
      units
    ]
    if (free && /time|duration/i.test(label) && seconds) media.remainingSeconds = n * seconds
  }
  if (/status|state/i.test(label)) media.status = text
  if (/\b(full|error|failed|read.only|not present|missing|unmounted)\b/i.test(text))
    media.warnings.push(text)
  return media
}
export function groupMedia(fields: RecorderMedia[]): RecorderMedia[] {
  const groups = new Map<string, RecorderMedia>()
  for (const field of fields) {
    const slot = field.label.match(
      /\b(?:SD(?: card)?|USB(?:\s*\d+)?|PAK\s*\d+|slot\s*[A-Z0-9]+|disk\s*\d+|SMB|NFS|network)\b/i,
    )?.[0]
    const current = /^current media/i.test(field.label)
    const id = slot?.toUpperCase().replace(/\s+/g, ' ') ?? (current ? 'Current media' : field.id)
    const old = groups.get(id)
    if (!old)
      groups.set(id, { ...field, id, label: slot ?? (current ? 'Current media' : field.label) })
    else
      groups.set(id, {
        ...old,
        ...Object.fromEntries(
          Object.entries(field).filter(
            ([key, value]) =>
              value !== undefined &&
              ['freeBytes', 'totalBytes', 'freePercent', 'remainingSeconds'].includes(key),
          ),
        ),
        status: field.status === 'Reported' ? old.status : field.status,
        active: old.active || field.active,
        updatedAt: Math.min(old.updatedAt, field.updatedAt),
        metrics: [...old.metrics, ...field.metrics],
        warnings: [...old.warnings, ...field.warnings],
      })
  }
  return [...groups.values()]
}
export class AjaRecorderAdapter implements RecorderAdapter {
  private transport = new AjaTransport()
  private address: string
  private controllers = new Set<AbortController>()
  private closed = false
  private descriptors?: Raw[]
  private media: RecorderMedia[] = []
  private mediaFields: RecorderMedia[] = []
  private identity = ''
  private firmware = ''
  private control = false
  private authenticated = false
  private helo: boolean
  private stateId: string
  private commandId: string
  constructor(
    private config: RecorderConfig,
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
    const timeout = setTimeout(() => controller.abort(), path === 'desc.json' ? 22000 : 3500)
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
  private async get(id: string) {
    return parameterResponse(
      await this.request(`config?${new URLSearchParams({ action: 'get', paramid: id })}`),
      id,
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
        d.param_id === 'eParamID_ProductID' ||
        d.param_id === 'eParamID_CurrentlyRunningImageVersion' ||
        /^(product( id| name| model)?|model( name)?|firmware( version)?|software version)$/i.test(
          String(d.param_name),
        ),
    )) {
      const value = String((await this.get(String(d.param_id))).value)
      if (
        d.param_id === 'eParamID_CurrentlyRunningImageVersion' ||
        /version|firmware/i.test(String(d.param_name))
      )
        this.firmware += ` ${value}`
      else if (!this.identity) this.identity = value
    }
    const compact = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/^aja/, '')
    const identityMatches = compact(this.identity) === compact(this.config.model)
    const command = descriptors.find((d) => d.param_id === this.commandId)
    const enums = Array.isArray(command?.enum_values) ? (command.enum_values as Raw[]) : []
    const isCommand = (value: number, label: RegExp) =>
      enums.some((e) => Number(e.value) === value && label.test(String(e.text)))
    const stateDescriptor = descriptors.find((d) => d.param_id === this.stateId)
    const states = Array.isArray(stateDescriptor?.enum_values)
      ? (stateDescriptor.enum_values as Raw[])
      : []
    const stateMatches =
      states.some((e) => Number(e.value) === 1 && /idle/i.test(String(e.text))) &&
      states.some((e) => Number(e.value) === 2 && /recording/i.test(String(e.text)))
    this.control =
      identityMatches &&
      stateMatches &&
      isCommand(this.helo ? 1 : 3, /^(start )?record(ing)?( command)?$/i) &&
      isCommand(
        this.helo ? 2 : 4,
        this.helo ? /^stop recording( command)?$/i : /^stop( command)?$/i,
      )
    this.descriptors = descriptors
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
      const candidates = this.descriptors!.filter(
        (d) =>
          /^eParamID_[a-zA-Z0-9_]+$/.test(String(d.param_id)) &&
          /media|disk|storage|\bsd\b|\busb\b|\bslot\b|\bpak\b|destination/i.test(
            String(d.param_name),
          ) &&
          /available|free|remaining|capacity|total|status|state|destination|write protect|mounted|present/i.test(
            String(d.param_name),
          ) &&
          !/command|format media/i.test(String(d.param_name)),
      )
      const next: RecorderMedia[] = []
      // Small batches bound requests per appliance and keep failed optional metrics independent.
      for (let i = 0; i < candidates.length; i += 4) {
        await Promise.all(
          candidates.slice(i, i + 4).map(async (d) => {
            const id = String(d.param_id)
            try {
              next.push(mediaMetric(d, await this.get(id), Date.now()))
            } catch {
              const old = this.mediaFields.find((m) => m.id === id)
              next.push(
                old
                  ? { ...old, warnings: ['Read failed — last value'] }
                  : {
                      id,
                      label: String(d.param_name),
                      status: 'Unknown',
                      active: false,
                      updatedAt: 0,
                      warnings: ['Read failed'],
                      metrics: [],
                    },
              )
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
        ? 'API mapped; hardware qualification pending'
        : 'Model identity or transport command descriptors could not be verified; monitor only',
    }
  }
  async command(action: 'record' | 'stop') {
    if (!this.control) throw new Error('Recorder command mapping is not verified')
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
