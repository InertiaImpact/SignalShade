import { AjaTransport } from './transport'
import {
  activeFsDescriptors,
  activeFsId,
  fsHdrColorBase,
  fsInputRoute,
  fsModeId,
  matchingDescriptor,
} from '../../extension/fs-parameters.js'
import {
  fs1Descriptors,
  fs1ReadIds,
  isFs1Identity,
  fs1ReadValue,
} from '../../extension/legacy-fs1.js'
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
const processorOf = (id: string) =>
  Number(id.match(/(?:Vid|Video|Processor|Ch)([1-4])(?=[A-Z_]|$)/i)?.[1] ?? '1')
function modelName(value: string): Model | undefined {
  const match = value
    .match(/\bFS(?:[- ]|\s*\|\s*)?HDR(?=\b|_)|\bFS1[- ]X(?=\b|_)|\bFS[124](?=\b|_)/i)?.[0]
    .toUpperCase()
  return match?.endsWith('HDR') ? 'FS-HDR' : (match?.replace(' ', '-') as Model | undefined)
}
function contextLabel(name: string) {
  return name.replace(/\b(?:vid|video|processor|channel)\s*[1-4]\s*/gi, '').trim()
}
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
  procamp: 'procEnabled',
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
function hdrSemantic(base: string): ParameterId | undefined {
  const tail = base.slice('eParamID_Vid0'.length)
  const yuvNames: Record<string, ParameterId> = {
    Gain: 'gain',
    Black: 'black',
    Hue: 'hue',
    Sat: 'saturation',
    Enable: 'procEnabled',
  }
  const yuv = tail.match(/^YUVProcAmp(Gain|Black|Hue|Sat|Enable)$/)?.[1]
  if (yuv) return yuvNames[yuv]
  if (tail === 'RGBProcAmpEnable') return 'rgbEnabled'
  const rgb = tail.match(/^RGBProcAmp(Gain|Black|Gamma)(Red|Green|Blue)$/)
  if (rgb) return (rgb[2].toLowerCase() + rgb[1]) as ParameterId
}
export function mapDescriptor(raw: Raw, semantic?: ParameterId): ParameterDescriptor | undefined {
  if (
    (Array.isArray(raw.class_names) && raw.class_names.includes('readonly')) ||
    /read_only/.test(String(raw.param_type))
  )
    return
  const nativeId = String(raw.param_id ?? '')
  if (!/^eParamID_[a-zA-Z0-9_]+$/.test(nativeId)) return
  const name = String(raw.param_name ?? '')
  const clean = name
    .toLowerCase()
    .replace(/\b(vid|video|processor|channel)\s*\d+\b/g, '')
    .replace(/[^a-z]/g, '')
  const id =
    semantic ??
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
function selectedResponse(input: unknown, paramId?: string): unknown {
  if (!Array.isArray(input)) return input
  const matches = input.filter(
    (x) =>
      x &&
      typeof x === 'object' &&
      paramId &&
      [x.name, x.paramid, x.param_id].some(
        (v) => v === paramId || (typeof v === 'string' && activeFsId(v) === paramId),
      ),
  )
  const candidates = matches.length ? matches : input
  if (candidates.length === 1) return candidates[0]
  const selected = candidates.filter(
    (x) => x && typeof x === 'object' && (x.selected === true || x.selected === 'true'),
  )
  return selected.length === 1 ? selected[0] : undefined
}
export function readValue(input: unknown, paramId: string): number {
  const object = selectedResponse(input, paramId)
  if (!object || typeof object !== 'object') throw new Error(`Unrecognized response for ${paramId}`)
  const o = object as Raw
  if (
    o.name !== paramId &&
    !(typeof o.name === 'string' && activeFsId(o.name) === paramId) &&
    ((typeof o.paramid === 'string' && activeFsId(o.paramid) !== paramId) ||
      (typeof o.param_id === 'string' && activeFsId(o.param_id) !== paramId))
  )
    throw new Error('Device returned a different parameter')
  const value = toNumber(o.value)
  if (!Number.isFinite(value)) throw new Error(`No numeric value for ${paramId}`)
  return value
}
function stringValue(input: unknown): string {
  const v = selectedResponse(input)
  return v && typeof v === 'object' && 'value' in v ? String(v.value) : ''
}
export class AjaAdapter implements DeviceAdapter {
  private legacyDescriptors = false
  private legacyJson = false
  private contextNames = new Map<string, string>()
  private hdrMode?: number
  private hdrRoutes = new Map<string, NonNullable<ReturnType<typeof fsInputRoute>>>()
  private hdrDescriptors: Raw[] = []
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
    const timeout = setTimeout(
      abort,
      /^(desc\.json|map\.json|descriptors\?)/.test(path) ? 22000 : 4500,
    )
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
  async readParameter(id: string, signal?: AbortSignal) {
    return this.request(
      `${this.legacyJson ? 'json' : 'config'}?${new URLSearchParams({ action: 'get', paramid: id, ...(this.legacyDescriptors || this.legacyJson ? { configid: '0', alt: 'json' } : {}) })}`,
      signal,
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
    return this.readChannel(channel)
  }
  private async readChannel(
    channel: Channel,
    signal?: AbortSignal,
    initialContext?: string,
  ): ReturnType<DeviceAdapter['read']> {
    const values: Values = {}
    const context = initialContext ?? (await this.readContext(channel.id, signal))
    for (const d of channel.descriptors) {
      const native = this.nativeFor(d, context)
      const value = readValue(await this.readParameter(native, signal), native)
      if (value < d.min || value > d.max)
        throw new Error(`${d.label} returned an out-of-range value`)
      values[d.id] = value
    }
    if (context !== (await this.readContext(channel.id, signal)))
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
      source: input
        ? (this.contextNames.get(input.id) ?? `Input ${contextValues.get(input.id)}`)
        : 'Input not reported',
      format: format
        ? (this.contextNames.get(format.id) ?? `Format ${contextValues.get(format.id)}`)
        : 'Format not reported',
    }
  }
  private async readContext(id: string, signal?: AbortSignal) {
    const parameters = this.contextParameters.get(id)
    if (!parameters?.length) return ''
    const parts: string[] = []
    for (const p of parameters) {
      const response = await this.readParameter(p.id, signal)
      const value = stringValue(response)
      if (p.id === fsModeId && this.hdrMode !== undefined && Number(value) !== this.hdrMode)
        throw new Error('FS-HDR operating mode changed; reconnect to refresh the processor list')
      const selected = selectedResponse(response) as Raw | undefined
      if (typeof selected?.value_name === 'string') this.contextNames.set(p.id, selected.value_name)
      if (!value) throw new Error(`Unable to read source context: ${p.label}`)
      parts.push(`${p.id}=${value}`)
    }
    return parts.join('|')
  }
  private nativeFor(descriptor: ParameterDescriptor, context: string) {
    const base = descriptor.nativeId!
    const route = this.hdrRoutes.get(base)
    if (!route) return base
    const value = context
      .split('|')
      .find((part) => part.startsWith(route.source + '='))
      ?.split('=')[1]
    const id = value && route.banks[value]
    const raw = id && matchingDescriptor(this.hdrDescriptors, id)
    const mapped = raw && mapDescriptor(raw, descriptor.id)
    if (!mapped || !id) throw new Error(`No readable FS-HDR input memory for ${base}`)
    if (
      (
        ['min', 'max', 'step', 'neutral', 'scale', 'offset', 'kind', 'unit', 'choices'] as const
      ).some((key) => JSON.stringify(mapped[key]) !== JSON.stringify(descriptor[key]))
    )
      throw new Error(`FS-HDR input memory changed range for ${base}; reconnect`)
    return id
  }
  private async probeHdr(
    raw: Raw[],
    result: ProbeResult,
    signal?: AbortSignal,
    progress?: (stage: string) => void,
  ) {
    try {
      progress?.('Reading FS-HDR operating mode')
      const modeResponse = await this.request(`config?action=get&paramid=${fsModeId}`, signal)
      const mode = readValue(modeResponse, fsModeId)
      if (![0, 1, 2].includes(mode)) throw new Error('Unrecognized FS-HDR operating mode')
      this.hdrMode = mode
      this.hdrDescriptors = raw
      this.hdrRoutes.clear()
      result.checks.push({
        name: 'Operating mode',
        status: 'pass',
        detail: mode === 2 ? '4K/UHD single channel (VID0)' : 'HD/SD four channel (VID1-4)',
      })
      let map: unknown
      try {
        progress?.('Reading FS-HDR input map')
        map = await this.request('map.json', signal)
        if (!map || typeof map !== 'object' || !('forward_maps' in map))
          throw new Error('Invalid FS-HDR parameter map')
      } catch (error) {
        throw new Error(
          /Unsupported AJA endpoint/.test(message(error))
            ? 'Update SignalShade Connect to 0.4.2 or newer to read the FS-HDR parameter map'
            : `FS-HDR parameter map: ${message(error)}`,
        )
      }
      const processors = mode === 2 ? [0] : [1, 2, 3, 4]
      for (const n of processors) {
        signal?.throwIfAborted()
        progress?.(`Checking color controls for VID${n}`)
        const processor = n || 1,
          prefix = `eParamID_Vid${n}`
        // Keep single-channel VID0 distinct from VID1 across a mode change.
        const id = `${this.address}/vid${n}`
        const context: ContextParameter[] = [{ id: fsModeId, label: 'Operating mode' }]
        const input = prefix + 'VideoInput',
          format = prefix + 'DetectedInputFormat'
        if (raw.some((r) => r.param_id === input)) context.push({ id: input, label: 'Video input' })
        if (raw.some((r) => r.param_id === format))
          context.push({ id: format, label: 'Detected input format' })
        const bases = new Set(
          raw.flatMap((d) => {
            const base = fsHdrColorBase(String(d.param_id))
            return base?.startsWith(prefix) && !String(d.param_id).endsWith('_status_page')
              ? [base]
              : []
          }),
        )
        for (const base of bases) {
          const route = fsInputRoute(map, base)
          if (!route) continue
          this.hdrRoutes.set(base, route)
          if (!context.some((p) => p.id === route.source))
            context.push({ id: route.source, label: 'Video input' })
        }
        this.contextParameters.set(id, context)
        try {
          if (signal?.aborted) throw new Error('Probe cancelled')
          const fingerprint = await this.readContext(id, signal)
          const descriptors: ParameterDescriptor[] = []
          for (const base of bases) {
            const semantic = hdrSemantic(base)
            if (!semantic) continue
            const route = this.hdrRoutes.get(base)
            const source =
              route &&
              fingerprint
                .split('|')
                .find((part) => part.startsWith(route.source + '='))
                ?.split('=')[1]
            const native = route ? source && route.banks[source] : base
            const definition = native && matchingDescriptor(raw, native)
            if (!definition) {
              if (route)
                throw new Error(`No descriptor for active FS-HDR input memory ${native || base}`)
              continue
            }
            const descriptor = mapDescriptor(definition, semantic)
            if (descriptor) descriptors.push({ ...descriptor, nativeId: base })
          }
          if (!descriptors.length) continue
          const channel: Channel = {
            id,
            deviceId: this.address,
            processor,
            label: `Processor ${processor}`,
            source: 'Device context',
            format: 'Read from device',
            context: fingerprint,
            descriptors,
            values: {},
            updatedAt: 0,
            locked: false,
            pending: false,
          }
          const state = await this.readChannel(channel, signal, fingerprint)
          if (state.context !== fingerprint)
            throw new Error('Source context changed while probing; reconnect')
          result.channels.push({ ...channel, ...state, updatedAt: Date.now() })
        } catch (error) {
          result.checks.push({ name: `VID${n}`, status: 'fail', detail: message(error) })
        }
      }
    } catch (error) {
      result.checks.push({ name: 'FS-HDR mapping', status: 'fail', detail: message(error) })
    }
    result.descriptors = result.channels.flatMap((c) => c.descriptors)
    result.checks.push({
      name: 'Color readback',
      status: result.channels.length ? 'pass' : 'fail',
      detail: `${result.channels.length} FS-HDR processors with ${result.descriptors.length} readable controls.`,
    })
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
    const native = this.nativeFor(descriptor, channel.context)
    await this.request(
      `${this.legacyJson ? 'json' : 'config'}?${new URLSearchParams({ action: 'set', paramid: native, value: String(value), configid: '0' })}`,
    )
    const readback = readValue(await this.readParameter(native), native)
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
  async probe(
    signal?: AbortSignal,
    modelHint?: Model,
    progress?: (stage: string) => void,
  ): Promise<ProbeResult> {
    const result: ProbeResult = {
      address: this.address,
      descriptors: [],
      channels: [],
      checks: [],
      rawDescriptorCount: 0,
    }
    let raw: Raw[] = []
    try {
      progress?.('Reading device descriptors')
      const response = await this.readDescriptors(signal)
      const extracted = extractDescriptors(response)
      result.rawDescriptorCount = extracted.length
      result.rawDescriptors = extracted
      raw = extracted
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
        if (isFs1Identity(result.webIdentity)) {
          result.legacyReadbacks = []
          // Endpoint and native IDs observed in AJA's original FS1 2.2.2.1 web interface.
          for (const id of fs1ReadIds) {
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
          const readable = result.legacyReadbacks.filter((r) =>
            fs1ReadValue(r.response, r.id),
          ).length
          if (readable === fs1ReadIds.length) {
            this.legacyJson = true
            result.model = 'FS1'
            result.firmware = 'Legacy FS1'
            raw = [
              ...fs1Descriptors,
              { param_id: fs1ReadIds[0], param_name: 'Input' },
              { param_id: fs1ReadIds[1], param_name: 'Input Format' },
            ]
            result.rawDescriptors = raw
            result.rawDescriptorCount = fs1Descriptors.length
          }
          result.checks.push({
            name: 'Original FS1 interface',
            status: this.legacyJson ? 'pass' : 'fail',
            detail: `${readable} / 7 legacy parameters readable. ${this.legacyJson ? 'Five native ProcAmp controls mapped.' : 'Could not read all original FS1 controls.'}`,
          })
        }
      }
      if (!this.legacyJson) {
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
    }
    progress?.('Identifying device')
    const identity = [
      ...new Map(
        raw
          .filter(
            (r) =>
              ['eParamID_ProductID', 'eParamID_SoftwareVersion'].includes(String(r.param_id)) ||
              /^(product( id| name| model)?|model( name)?|firmware( version)?|software version)$/i.test(
                String(r.param_name),
              ),
          )
          .map((r) => [r.param_id, r]),
      ).values(),
    ]
    const ids = new Set(raw.map((d) => String(d.param_id)))
    const fsShading = [...ids].some((id) => fsHdrColorBase(id))
    const hdrSignature =
      fsShading &&
      [0, 1, 2, 3, 4].some(
        (n) =>
          ids.has(`eParamID_Vid${n}ColorHDRTransform`) && ids.has(`eParamID_Vid${n}ColorfrontMode`),
      )
    const hdrCandidate = hdrSignature || (modelHint === 'FS-HDR' && fsShading)
    let identification = ''
    let identitySource = ''
    for (const r of identity) {
      try {
        const id = String(r.param_id)
        const response = selectedResponse(await this.readParameter(id, signal), id)
        const value = stringValue(response)
        identification += ` ${value}`
        if (id === 'eParamID_ProductID' && !modelName(value)) {
          const name = response && typeof response === 'object' ? (response as Raw).value_name : ''
          if (typeof name === 'string') identification += ` ${name}`
        }
      } catch {
        /* reported below */
      }
    }
    result.model ??= modelName(identification)
    if (!result.model && hdrCandidate && !signal?.aborted) {
      // Some firmware serves a large shading table without usable identity entries.
      // Try the firmware's canonical REST queries even when omitted from desc.json.
      for (const id of ['eParamID_ProductID', 'eParamID_SoftwareVersion']) {
        if (
          signal?.aborted ||
          (id.endsWith('SoftwareVersion') && /\b\d+\.\d+\.\d+\b/.test(identification))
        )
          continue
        try {
          const response = selectedResponse(
            await this.request(`config?action=get&paramid=${id}&alt=json`, signal),
            id,
          )
          const value = stringValue(response)
          if (id === 'eParamID_ProductID') {
            const name =
              response && typeof response === 'object' ? (response as Raw).value_name : ''
            result.model = modelName(value) ?? modelName(typeof name === 'string' ? name : '')
            if (result.model) identitySource = 'canonical REST identity'
          }
          if (value) identification += ` ${value}`
        } catch {
          // Model-specific probing can continue with corroborating descriptors.
        }
      }
    }
    if (!result.model && !hdrCandidate) {
      try {
        result.webIdentity = (await this.request(
          'device-info',
          signal,
        )) as ProbeResult['webIdentity']
        if (
          /\bAJA\b/i.test(result.webIdentity?.title ?? '') ||
          (result.webIdentity as { aja?: boolean })?.aja
        )
          result.model =
            modelName(result.webIdentity?.title ?? '') ?? modelName(result.webIdentity?.model ?? '')
      } catch {
        /* Retain the API identity failure below. */
      }
    }
    if (!result.model && hdrCandidate && !signal?.aborted) {
      result.model = 'FS-HDR'
      identitySource = hdrSignature
        ? 'FS-HDR descriptor signature'
        : 'selected FS-HDR with matching FS descriptors'
    }
    if (result.model && !['FS4', 'FS2', 'FS1-X', 'FS1', 'FS-HDR'].includes(result.model))
      result.model = undefined
    result.firmware ??= identification.trim() || 'Unidentified'
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
        ? `${result.model} · ${result.firmware}${identitySource ? ' · ' + identitySource : ''}`
        : 'Device did not report an AJA FS model. Model identification is needed to add it.',
    })
    if (result.model === 'FS-HDR') {
      await this.probeHdr(raw, result, signal, progress)
      return result
    }
    if (!result.model) return result
    try {
      raw = activeFsDescriptors(raw)
    } catch (error) {
      result.checks.push({ name: 'Ambiguous mapping', status: 'fail', detail: message(error) })
      return result
    }
    const groups = new Map<number, ParameterDescriptor[]>()
    for (const r of raw) {
      const mapped = mapDescriptor(r)
      if (!mapped) continue
      const processor = processorOf(String(r.param_id))
      const list = groups.get(processor) ?? []
      if (list.some((d) => d.id === mapped.id)) {
        result.checks.push({
          name: 'Ambiguous mapping',
          status: 'fail',
          detail: `Processor ${processor}: multiple descriptors match ${mapped.id} (${list.find((d) => d.id === mapped.id)?.nativeId}, ${mapped.nativeId}). Hardware controls remain locked.`,
        })
        continue
      }
      list.push(mapped)
      groups.set(processor, list)
    }
    for (const [processor, descriptors] of groups) {
      if (signal?.aborted) throw new Error('Probe cancelled')
      progress?.(`Checking color controls for VID${processor}`)
      const id = `${this.address}/vid${processor}`
      const context = raw
        .filter(
          (r) =>
            /^(video )?(input|source)( select| selection| source| format)?$/i.test(
              contextLabel(String(r.param_name)),
            ) ||
            /^(input format|operating mode|channel mode|system mode)$/i.test(String(r.param_name)),
        )
        .filter((r) => {
          const native = String(r.param_id)
          return (
            !/(?:Vid|Video|Processor|Ch)[1-4]/i.test(native) || processorOf(native) === processor
          )
        })
        .map((r) => ({ id: String(r.param_id), label: contextLabel(String(r.param_name)) }))
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
        const state = await this.readChannel(channel, signal)
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
      detail: `${result.channels.length} processors with recognized color descriptors and readable values. Scaled values are displayed in native device units.`,
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
