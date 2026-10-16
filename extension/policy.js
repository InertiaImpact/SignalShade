import { fs1ReadIds, fs1Descriptors } from './legacy-fs1.js'
export const SITE = 'https://inertiaimpact.github.io'
export function trustedPage(input) {
  try {
    const u = new URL(input)
    return u.origin === SITE && u.pathname.startsWith('/SignalShade/')
  } catch {
    return false
  }
}
export function deviceOrigin(input) {
  const u = new URL(input)
  const octets = u.hostname.split('.').map(Number)
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    octets.length !== 4 ||
    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    !(
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    )
  )
    throw new Error('Only private LAN IPv4 device addresses are supported by Connect')
  return u.origin
}
export function operation(path) {
  if (path === 'device-info') return { kind: 'identity' }
  if (path === 'desc.json') return { kind: 'descriptors' }
  if (path === 'descriptors?paramid=*') return { kind: 'descriptors' }
  if (path === 'authenticator/login') return { kind: 'login' }
  const legacy = typeof path === 'string' && path.startsWith('json?')
  if (typeof path !== 'string' || (!path.startsWith('config?') && !legacy))
    throw new Error('Unsupported AJA endpoint')
  const q = new URLSearchParams(path.slice(legacy ? 5 : 7))
  const keys = [...q.keys()]
  if (
    keys.length !== new Set(keys).size ||
    keys.some((k) => !['action', 'paramid', 'value', 'configid', 'alt'].includes(k))
  )
    throw new Error('Invalid query')
  const id = q.get('paramid')
  if (!/^eParamID_[A-Za-z0-9_]{1,120}$/.test(id ?? '')) throw new Error('Invalid parameter')
  if (
    legacy &&
    !(q.get('action') === 'get'
      ? fs1ReadIds.includes(id) || id === 'eParamID_SysName'
      : q.get('action') === 'set' && fs1Descriptors.some((d) => d.param_id === id))
  )
    throw new Error(
      'Only FS1 status reads and bounded ProcAmp controls are supported on the legacy endpoint',
    )
  if (
    q.get('action') === 'get' &&
    !q.has('value') &&
    (!q.has('alt') || q.get('alt') === 'json') &&
    (!q.has('configid') || q.get('configid') === '0')
  )
    return { kind: 'read', id }
  if (
    q.get('action') === 'set' &&
    keys.length === 4 &&
    q.get('configid') === '0' &&
    q.get('value')?.trim()
  ) {
    const value = Number(q.get('value'))
    if (Number.isFinite(value)) return { kind: 'write', id, value }
  }
  throw new Error('Unsupported AJA operation')
}
export function scanOrigins(start, end) {
  const a = new URL(deviceOrigin(start)),
    b = new URL(deviceOrigin(end))
  const x = a.hostname.split('.'),
    y = b.hostname.split('.')
  if (
    a.protocol !== 'http:' ||
    b.protocol !== 'http:' ||
    a.port ||
    b.port ||
    x.slice(0, 3).join('.') !== y.slice(0, 3).join('.')
  )
    throw new Error('Scan one private IPv4 /24 subnet over HTTP')
  const first = Math.max(1, Number(x[3])),
    last = Math.min(254, Number(y[3]))
  if (first > last) throw new Error('Enter an ascending address range')
  return Array.from(
    { length: last - first + 1 },
    (_, i) => `http://${x.slice(0, 3).join('.')}.${first + i}`,
  )
}
export function descriptors(input, depth = 0) {
  if (depth > 12 || !input || typeof input !== 'object') return []
  if (typeof input.param_id === 'string') return [input]
  return Object.values(input).flatMap((v) => descriptors(v, depth + 1))
}
export function validateWrite(op, list) {
  const d = list.find((d) => d.param_id === op.id)
  if (!d) throw new Error('Parameter was not discovered on this device')
  if (d.class_names?.includes('readonly') || /read_only/.test(String(d.param_type)))
    throw new Error('Parameter is read-only')
  if (['eParamID_ReplicatorCommand', 'eParamID_TransportCommand'].includes(op.id)) {
    const helo = op.id === 'eParamID_ReplicatorCommand'
    if (!(helo ? [1, 2] : [3, 4]).includes(op.value))
      throw new Error('Only Record and Stop commands are supported')
    if (
      Array.isArray(d.enum_values) &&
      d.enum_values.length &&
      !d.enum_values.some((e) => Number(e.value) === op.value)
    )
      throw new Error('Command value is not available on this device')
    if (
      (d.min_value !== undefined && op.value < Number(d.min_value)) ||
      (d.max_value !== undefined && op.value > Number(d.max_value))
    )
      throw new Error('Command value is outside the device range')
    return
  }
  const name = String(d.param_name ?? '')
    .toLowerCase()
    .replace(/\b(vid|video|processor|channel)\s*\d+\b/g, '')
    .replace(/[^a-z]/g, '')
  if (
    !/^(procamp(gain|black|blacklevel|hue|sat|saturation|enableyuv|yuv|enable)?|colorcorrector(rgb|enable)?|color(red|green|blue)(gain|black|blacklevel|gamma))$/.test(
      name,
    )
  )
    throw new Error('Only supported FS shading parameters may be changed')
  const min = Number(d.min_value),
    max = Number(d.max_value)
  const step = Number(d.adjust_by)
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    op.value < min ||
    op.value > max ||
    (Number.isFinite(step) &&
      step > 0 &&
      Math.abs((op.value - min) / step - Math.round((op.value - min) / step)) > 1e-6) ||
    (Array.isArray(d.enum_values) && !d.enum_values.some((e) => Number(e.value) === op.value))
  )
    throw new Error('Value outside device range')
}
