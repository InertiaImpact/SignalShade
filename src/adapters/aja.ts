import { AjaTransport } from './transport'
import type {
  Channel,
  DeviceAdapter,
  Model,
  ParameterDescriptor,
  ParameterId,
  ProbeResult,
  Values,
} from '../core/types'

type Raw = Record<string, unknown>
export type ContextParameter = { id: string; label: string }
export function normalizeAddress(input: string): string {
  const url = new URL(input.includes('://') ? input : `http://${input}`)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Enter a private IPv4 address, with optional http(s) and port')
  const parts = url.hostname.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    !(
      parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 127
    )
  )
    throw new Error('Use a private LAN IPv4 address, such as 192.168.1.20')
  return url.origin
}
export function extractDescriptors(input: unknown): Raw[] {
  const output: Raw[] = []
  function walk(value: unknown, depth = 0) {
    if (depth > 12 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((x) => walk(x, depth + 1))
      return
    }
    const obj = value as Raw
    if (typeof obj.param_id === 'string') output.push(obj)
    else Object.values(obj).forEach((x) => walk(x, depth + 1))
  }
  walk(input)
  return output
}
const semanticNames: Record<string, ParameterId> = {
  procampgain: 'gain',
  procampblack: 'black',
  procampblacklevel: 'black',
  procamphue: 'hue',
  procampsat: 'saturation',
  procampsaturation: 'saturation',
  procampenableyuv: 'procEnabled',
  procampyuv: 'procEnabled',
  procampenable: 'procEnabled',
  colorcorrectorrgb: 'rgbEnabled',
  colorcorrectorenable: 'rgbEnabled',
  colorcorrector: 'rgbEnabled',
  colorredgain: 'redGain',
  colorgreengain: 'greenGain',
  colorbluegain: 'blueGain',
  colorredblack: 'redBlack',
  colorgreenblack: 'greenBlack',
  colorblueblack: 'blueBlack',
  colorredblacklevel: 'redBlack',
  colorgreenblacklevel: 'greenBlack',
  colorblueblacklevel: 'blueBlack',
  colorredgamma: 'redGamma',
  colorgreengamma: 'greenGamma',
  colorbluegamma: 'blueGamma',
}
const toNumber = (v: unknown) =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
export function mapDescriptor(raw: Raw): ParameterDescriptor | undefined {
  const nativeId = String(raw.param_id ?? '')
  if (!/^eParamID_[a-zA-Z0-9_]+$/.test(nativeId)) return
  const name = String(raw.param_name ?? '')
  const clean = name
    .toLowerCase()
    .replace(/\b(vid|video|processor|channel)\s*\d+\b/g, '')
    .replace(/[^a-z]/g, '')
  const id =
    semanticNames[clean] ??
    // Legalizer identifiers remain device-native to avoid pretending different clipping modes are equivalent.
    (/^(whiteclip|blackclip|chromaclip|videolegalizer|legalizermode)$/.test(clean)
      ? (`legalizer.${nativeId}` as ParameterId)
      : undefined)
  if (!id) return
  const min = toNumber(raw.min_value),
    max = toNumber(raw.max_value),
    step = toNumber(raw.adjust_by),
    neutral = toNumber(raw.default_value)
  const scale = raw.scale_by === undefined ? 1 : toNumber(raw.scale_by)
  const offset = raw.offset_by === undefined ? 0 : toNumber(raw.offset_by)
  // Raw native values are deliberately shown: device scaling conventions must be hardware-qualified before converting units.
  if (
    ![min, max, step, neutral, scale, offset].every(Number.isFinite) ||
    step <= 0 ||
    max < min ||
    neutral < min ||
    neutral > max ||
    scale === 0
  )
    return
  const choices = Array.isArray(raw.enum_values)
    ? raw.enum_values
        .map((entry: unknown) => {
          const e = entry as Raw
          return { value: toNumber(e.value), label: String(e.text ?? e.short_text ?? e.value) }
        })
        .filter((e) => Number.isFinite(e.value))
    : undefined
  if (choices?.length === 0) return
  const kind = choices ? 'enum' : 'number'
  const precision = Math.min(6, Math.max(0, String(step).split('.')[1]?.length ?? 0))
  return {
    id,
    label: name,
    section: id.startsWith('legalizer.')
      ? 'Legalizer'
      : /^(red|green|blue)|rgbEnabled/.test(id)
        ? 'RGB correction'
        : 'Proc amp',
    min,
    max,
    step,
    neutral,
    unit: scale === 1 && offset === 0 ? String(raw.units ?? '') : 'native',
    precision,
    kind,
    nativeId,
    scale,
    offset,
    choices,
  }
}
export function readValue(input: unknown, paramId: string): number {
  const object = Array.isArray(input)
    ? (input.find(
        (x) => x && typeof x === 'object' && [x.name, x.paramid, x.param_id].includes(paramId),
      ) ?? (input.length === 1 ? input[0] : undefined))
    : input
  if (!object || typeof object !== 'object') throw new Error(`Unrecognized response for ${paramId}`)
  const o = object as Raw
  if (
    o.name !== paramId &&
    ((typeof o.paramid === 'string' && o.paramid !== paramId) ||
      (typeof o.param_id === 'string' && o.param_id !== paramId))
  )
    throw new Error('Device returned a different parameter')
  const value = toNumber(o.value)
  if (!Number.isFinite(value)) throw new Error(`No numeric value for ${paramId}`)
  return value
}
function stringValue(input: unknown): string {
  const v = Array.isArray(input) ? input[0] : input
  return v && typeof v === 'object' && 'value' in v ? String(v.value) : ''
}
export class AjaAdapter implements DeviceAdapter {
  private legacyDescriptors = false
  private transport = new AjaTransport()
  readonly address: string
  private controllers = new Set<AbortController>()
  private disposed = false
  constructor(
    address: string,
    private authorization?: string,
    private contextParameters: Map<string, ContextParameter[]> = new Map(),
  ) {
    this.address = normalizeAddress(address)
  }
  async request(path: string, signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) throw new Error('Connection was closed')
    const controller = new AbortController()
    this.controllers.add(controller)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    const timeout = setTimeout(abort, /^(desc.json|descriptors\?)/.test(path) ? 22000 : 3500)
    try {
      const options: RequestInit & { targetAddressSpace?: string } = {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        targetAddressSpace: 'local',
      }
      if (this.authorization) options.headers = { Authorization: this.authorization }
      const response = await this.transport.fetch(this.address, path, options)
      if (!response.ok) throw new Error(`Device returned HTTP ${response.status}`)
      return await response.json()
    } finally {
      clearTimeout(timeout)
      this.controllers.delete(controller)
      signal?.removeEventListener('abort', abort)
    }
  }
  async readParameter(id: string) {
    return this.request(
      `config?${new URLSearchParams({ action: 'get', paramid: id, ...(this.legacyDescriptors ? { configid: '0', alt: 'json' } : {}) })}`,
    )
  }
  async readDescriptors(signal?: AbortSignal): Promise<unknown> {
    try {
      return await this.request('desc.json', signal)
    } catch (e) {
      if (!/HTTP (404|410)\b/.test(message(e))) throw e
      const raw = await this.request('descriptors?paramid=*', signal)
      this.legacyDescriptors = true
      return raw
    }
  }
  async read(channel: Channel): ReturnType<DeviceAdapter['read']> {
    const values: Values = {}
    const context = await this.readContext(channel.id)
    for (const d of channel.descriptors) {
      const value = readValue(await this.readParameter(d.nativeId!), d.nativeId!)
      if (value < d.min || value > d.max)
        throw new Error(`${d.label} returned an out-of-range value`)
      values[d.id] = value
    }
    if (context !== (await this.readContext(channel.id)))
      throw new Error('Source context changed while reading; refresh again')
    const contextValues = new Map(
      context.split('|').map((part) => {
        const [id, value] = part.split('=')
        return [id, value]
      }),
    )
    const metadata = this.contextParameters.get(channel.id) ?? []
    const input = metadata.find((p) =>
      /^(video )?(input|source)( select| selection| source)?$/i.test(p.label),
    )
    const format = metadata.find((p) => /format/i.test(p.label))
    return {
      values,
      context,
      source: input ? `Input ${contextValues.get(input.id)}` : 'Unknown input',
      format: format ? `Format ${contextValues.get(format.id)} (native)` : 'Unknown format',
    }
  }
  private async readContext(id: string) {
    const parameters = this.contextParameters.get(id)
    if (!parameters?.length)
      throw new Error('Source context descriptors unavailable; device remains read-only')
    const parts: string[] = []
    for (const p of parameters) {
      const value = stringValue(await this.readParameter(p.id))
      if (!value) throw new Error(`Unable to read source context: ${p.label}`)
      parts.push(`${p.id}=${value}`)
    }
    return parts.join('|')
  }
  async write(channel: Channel, descriptor: ParameterDescriptor, value: number) {
    if (
      !descriptor.nativeId ||
      !channel.descriptors.some((d) => d.nativeId === descriptor.nativeId) ||
      value < descriptor.min ||
      value > descriptor.max ||
      !Number.isFinite(value)
    )
      throw new Error('Invalid hardware parameter or value')
    if (channel.context !== (await this.readContext(channel.id)))
      throw new Error('Source changed; refresh before adjusting')
    await this.request(
      `config?${new URLSearchParams({ action: 'set', paramid: descriptor.nativeId, value: String(value), configid: '0' })}`,
    )
    const readback = readValue(await this.readParameter(descriptor.nativeId), descriptor.nativeId)
    if ((await this.readContext(channel.id)) !== channel.context)
      throw new Error('Source changed during write; result is uncertain')
    if (Math.abs(readback - value) > descriptor.step / 10)
      throw new Error(`Readback mismatch: requested ${value}, received ${readback}`)
    return readback
  }
  dispose() {
    this.disposed = true
    this.controllers.forEach((c) => c.abort())
    this.controllers.clear()
  }
  async probe(signal?: AbortSignal): Promise<ProbeResult> {
    const result: ProbeResult = {
      address: this.address,
      descriptors: [],
      channels: [],
      checks: [],
      rawDescriptorCount: 0,
    }
    let raw: Raw[]
    try {
      const response = await this.readDescriptors(signal)
      raw = extractDescriptors(response)
      result.rawDescriptorCount = raw.length
      result.rawDescriptors = raw
      if (!raw.length) throw new Error('No recognized parameter descriptors in desc.json')
      result.checks.push({
        name: 'Readable API',
        status: 'pass',
        detail: `${raw.length} parameter descriptors readable from this browser origin.`,
      })
    } catch (e) {
      if (/HTTP (404|410)\b/.test(message(e))) {
        try {
          result.webIdentity = (await this.request(
            'device-info',
            signal,
          )) as ProbeResult['webIdentity']
        } catch {
          /* Preserve the descriptor failure. */
        }
        if (
          result.webIdentity?.model === 'FS1' &&
          /\bAJA\b/i.test(result.webIdentity.title ?? '')
        ) {
          result.legacyReadbacks = []
          // Endpoint and native IDs observed in AJA's original FS1 2.2.2.1 web interface.
          // Diagnostic reads only: no fabricated descriptor ranges or write mapping.
          for (const id of [
            'eParamID_VideoInputSelect',
            'eParamID_DetectInputFormat',
            'eParamID_ProcAmpEnable',
            'eParamID_ProcAmpBlackYCGain',
            'eParamID_ProcAmpBlackYCOffset',
            'eParamID_ProcAmpHue',
            'eParamID_ProcAmpSat',
          ]) {
            if (signal?.aborted) break
            try {
              result.legacyReadbacks.push({
                id,
                response: await this.request(
                  `json?${new URLSearchParams({ action: 'get', paramid: id, configid: '0', alt: 'json' })}`,
                  signal,
                ),
              })
            } catch (error) {
              result.legacyReadbacks.push({ id, error: message(error) })
            }
          }
          const readable = result.legacyReadbacks.filter(
            (r) => r.response && typeof r.response === 'object' && 'value' in r.response,
          ).length
          result.checks.push({
            name: 'Original FS1 interface',
            status: 'info',
            detail: `${readable} / 7 legacy parameters returned readable values. Diagnostic values are included in this report; shading remains unavailable until the legacy mapping is verified.`,
          })
        }
      }
      result.checks.push({
        name: 'Readable API',
        status: 'fail',
        detail: /HTTP (404|410)\b/.test(message(e))
          ? `${message(e)}. Neither AJA descriptor endpoint was found.${result.webIdentity?.model ? ` Web interface: ${result.webIdentity.model}.` : ''} Device access is allowed; approval cannot fix a missing endpoint. This firmware needs a separate API mapping; export this report.`
          : /response.*exceeds.*(MB|MiB)/i.test(message(e))
            ? `${message(e)}. The connection reached the device, but Connect stopped the download at its response-size limit. Update SignalShade Connect and retry.`
            : `${message(e)}. Check network, device address, browser access, and authentication.`,
      })
      return result
    }
    const identity = raw.filter((r) =>
      /^(product( id| name| model)?|model( name)?|firmware( version)?|software version)$/i.test(
        String(r.param_name),
      ),
    )
    let identification = ''
    for (const r of identity) {
      try {
        identification += ` ${stringValue(await this.readParameter(String(r.param_id)))}`
      } catch {
        /* reported below */
      }
    }
    const model = identification
      .match(/\bFS[- ]?HDR\b|\bFS1[- ]X\b|\bFS4\b|\bFS2\b|\bFS1\b/i)?.[0]
      .toUpperCase()
      .replace(' ', '-')
    result.model = model === 'FSHDR' ? 'FS-HDR' : (model as Model | undefined)
    if (result.model && !['FS4', 'FS2', 'FS1-X', 'FS1', 'FS-HDR'].includes(result.model))
      result.model = undefined
    result.firmware = identification.trim() || 'Unidentified'
    if (result.model === 'FS-HDR')
      result.checks.push({
        name: 'SDR workflow',
        status: 'info',
        detail:
          'Only conventional SDR Proc Amp / RGB controls are mapped. Confirm the unit is configured for SDR. This app does not change Colorfront, LUT, or HDR transforms.',
      })
    result.checks.push({
      name: 'Device identity',
      status: result.model ? 'pass' : 'fail',
      detail: result.model
        ? `${result.model} · ${result.firmware}`
        : 'Could not verify an AJA FS model from device identity parameters. Read-only diagnostics only.',
    })
    const groups = new Map<number, ParameterDescriptor[]>()
    for (const r of raw) {
      const mapped = mapDescriptor(r)
      if (!mapped) continue
      const processor = Number(
        String(r.param_id).match(/(?:Vid|Video|Processor|Ch)([1-4])(?:_|$)/i)?.[1] ?? '1',
      )
      const list = groups.get(processor) ?? []
      if (list.some((d) => d.id === mapped.id)) {
        result.checks.push({
          name: 'Ambiguous mapping',
          status: 'fail',
          detail: `Processor ${processor}: multiple descriptors match ${mapped.id}. Hardware controls remain locked.`,
        })
        continue
      }
      list.push(mapped)
      groups.set(processor, list)
    }
    for (const [processor, descriptors] of groups) {
      if (signal?.aborted) throw new Error('Probe cancelled')
      const id = `${this.address}/vid${processor}`
      const context = raw
        .filter(
          (r) =>
            /^(video )?(input|source)( select| selection| source| format)?$/i.test(
              String(r.param_name),
            ) ||
            /^(input format|operating mode|channel mode|system mode)$/i.test(String(r.param_name)),
        )
        .filter((r) => {
          const p = String(r.param_id).match(/(?:Vid|Video|Processor|Ch)([1-4])(?:_|$)/i)
          return !p || Number(p[1]) === processor
        })
        .map((r) => ({ id: String(r.param_id), label: String(r.param_name) }))
      const hasSource = context.some((p) =>
        /^(video )?(input|source)( select| selection| source)?$/i.test(p.label),
      )
      const hasFormat = context.some((p) => /^(video )?(input|source) format$/i.test(p.label))
      const hasMode = context.some((p) =>
        /^(operating mode|channel mode|system mode)$/i.test(p.label),
      )
      if (!hasSource || !hasFormat || (groups.size > 1 && !hasMode)) {
        result.checks.push({
          name: `Processor ${processor} context`,
          status: 'fail',
          detail:
            'Source, input-format, and (for multi-processor units) operating-mode descriptors must be identified before controls can be enabled. Export the report to qualify this firmware.',
        })
        continue
      }
      this.contextParameters.set(id, context)
      const channel: Channel = {
        id,
        deviceId: this.address,
        processor,
        label: `Processor ${processor}`,
        source: 'Device context',
        format: 'Read from device',
        context: '',
        descriptors,
        values: {},
        updatedAt: 0,
        locked: false,
        pending: false,
      }
      try {
        const state = await this.read(channel)
        Object.assign(channel, state, { updatedAt: Date.now() })
        result.channels.push(channel)
      } catch (e) {
        result.checks.push({ name: `Processor ${processor}`, status: 'fail', detail: message(e) })
      }
    }
    result.descriptors = result.channels.flatMap((c) => c.descriptors)
    result.checks.push({
      name: 'Color readback',
      status: result.channels.length ? 'pass' : 'fail',
      detail: `${result.channels.length} processors with recognized color descriptors and readable source context. Scaled values are displayed in native device units.`,
    })
    result.checks.push({
      name: 'Hardware qualification',
      status: 'info',
      detail:
        'Read-only checks complete. No video settings changed. Each model/firmware still needs an off-air write/readback test before production use.',
    })
    return result
  }
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
export function ipv4Range(start: string, end: string): string[] {
  const a = new URL(normalizeAddress(start)),
    b = new URL(normalizeAddress(end))
  if (a.hostname.split('.').slice(0, 3).join('.') !== b.hostname.split('.').slice(0, 3).join('.'))
    throw new Error('Scan one /24 subnet at a time')
  const first = Math.max(1, Number(a.hostname.split('.')[3])),
    last = Math.min(254, Number(b.hostname.split('.')[3]))
  if (last < first || last - first > 255 || a.port || b.port)
    throw new Error('Enter an ascending IPv4 range without ports')
  return Array.from(
    { length: last - first + 1 },
    (_, i) => `${a.hostname.split('.').slice(0, 3).join('.')}.${first + i}`,
  )
}
