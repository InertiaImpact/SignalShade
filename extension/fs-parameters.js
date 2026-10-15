// FS2 enumerates stored input memories, often repeating a native descriptor.
// Its unsuffixed IDs address the active memory. Expose those aliases only when
// every bank has the same numeric/enum semantics; probe still reads each alias.
const bank =
  /^(eParamID_Vid[1-4](?:YUVProcAmp(?:Gain|Black|Hue|Sat|Enable)|RGBProcAmp(?:Enable|(?:Gain|Black|Gamma)(?:Red|Green|Blue))))_(?:SDI[12]|SDIDualLink|Fiber[12]|FiberDualLink|HDMI|Composite|Component)$/
const fields = [
  'param_name',
  'min_value',
  'max_value',
  'default_value',
  'adjust_by',
  'scale_by',
  'offset_by',
  'units',
  'enum_values',
]
const semantics = (d) => JSON.stringify(fields.map((key) => d[key]))
export const activeFsId = (id) => String(id).match(bank)?.[1] ?? id
export function activeFsDescriptors(list) {
  const unique = new Map()
  for (const d of list) {
    const old = unique.get(d.param_id)
    if (old && semantics(old) !== semantics(d))
      throw new Error(`Conflicting descriptors for ${d.param_id}`)
    unique.set(d.param_id, d)
  }
  const aliases = new Map(),
    result = []
  for (const d of unique.values()) {
    const match = String(d.param_id).match(bank)
    if (!match) {
      result.push(d)
      continue
    }
    const id = match[1],
      previous = aliases.get(id)
    if (previous && semantics(previous) !== semantics(d))
      throw new Error(`Input memories have incompatible ranges for ${id}`)
    aliases.set(id, d)
  }
  for (const [id, d] of aliases) {
    const explicit = unique.get(id)
    if (explicit && semantics(explicit) !== semantics(d))
      throw new Error(`Active control has incompatible ranges for ${id}`)
    if (!explicit) result.push({ ...d, param_id: id })
  }
  return result
}
