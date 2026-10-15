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
  if (path === 'desc.json') return { kind: 'descriptors' }
  if (path === 'authenticator/login') return { kind: 'login' }
  if (typeof path !== 'string' || !path.startsWith('config?'))
    throw new Error('Unsupported AJA endpoint')
  const q = new URLSearchParams(path.slice(7))
  const keys = [...q.keys()]
  if (
    keys.length !== new Set(keys).size ||
    keys.some((k) => !['action', 'paramid', 'value', 'configid'].includes(k))
  )
    throw new Error('Invalid query')
  const id = q.get('paramid')
  if (!/^eParamID_[A-Za-z0-9_]{1,120}$/.test(id ?? '')) throw new Error('Invalid parameter')
  if (q.get('action') === 'get' && keys.length === 2) return { kind: 'read', id }
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
export function descriptors(input, depth = 0) {
  if (depth > 12 || !input || typeof input !== 'object') return []
  if (typeof input.param_id === 'string') return [input]
  return Object.values(input).flatMap((v) => descriptors(v, depth + 1))
}
export function validateWrite(op, list) {
  const d = list.find((d) => d.param_id === op.id)
  if (!d) throw new Error('Parameter was not discovered on this device')
  if (['eParamID_ReplicatorCommand', 'eParamID_TransportCommand'].includes(op.id)) {
    const helo = op.id === 'eParamID_ReplicatorCommand'
    const expected =
      op.value === (helo ? 1 : 3)
        ? /^(start )?record(ing)?( command)?$/i
        : op.value === (helo ? 2 : 4)
          ? helo
            ? /^stop recording( command)?$/i
            : /^stop( command)?$/i
          : null
    if (
      expected &&
      d.enum_values?.some((e) => Number(e.value) === op.value && expected.test(e.text))
    )
      return
    throw new Error('Only verified Record and Stop commands are permitted')
  }
  const name = String(d.param_name ?? '')
    .toLowerCase()
    .replace(/\b(vid|video|processor|channel)\s*\d+\b/g, '')
    .replace(/[^a-z]/g, '')
  if (
    !/^(procamp(gain|black|blacklevel|hue|sat|saturation|enableyuv|yuv|enable)|colorcorrector(rgb|enable)?|color(red|green|blue)(gain|black|blacklevel|gamma))$/.test(
      name,
    )
  )
    throw new Error('Only supported FS shading parameters may be changed')
  const min = Number(d.min_value),
    max = Number(d.max_value)
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    op.value < min ||
    op.value > max ||
    (Array.isArray(d.enum_values) && !d.enum_values.some((e) => Number(e.value) === op.value))
  )
    throw new Error('Value outside device range')
}
