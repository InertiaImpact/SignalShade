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
// FS-HDR describes the same Proc Amp controls for VID0 (single channel) and
// VID1–4, and its web UI resolves stored input memories through /map.json.
export function fsHdrColorBase(id) {
  return String(id).match(
    /^(eParamID_Vid[0-4](?:YUVProcAmp(?:Gain|Black|Hue|Sat|Enable)|RGBProcAmp(?:Enable|(?:Gain|Black|Gamma)(?:Red|Green|Blue))))(?:_[A-Za-z0-9_]+)?$/,
  )?.[1]
}
export const fsModeId = 'eParamID_FS4Mode'
export function fsInputRoute(map, base) {
  const route = map?.forward_maps?.[base]
  if (!route || route.map_scheme === 0) return
  const processor = base.match(/^eParamID_Vid([0-4])/)?.[1]
  const source = route.depends_on?.[0]
  if (
    route.map_scheme !== 1 ||
    !Array.isArray(route.depends_on) ||
    route.depends_on.length !== 1 ||
    ![`eParamID_Vid${processor}VideoInput`, `eParamID_Vid${processor}ActualVideoInput`].includes(
      source,
    ) ||
    !route.param_maps ||
    typeof route.param_maps !== 'object'
  )
    throw new Error('Unsupported FS input map for ' + base)
  const banks = Object.fromEntries(
    Object.entries(route.param_maps).filter(
      ([key, id]) =>
        /^\d+$/.test(key) && fsHdrColorBase(id) === base && !String(id).endsWith('_status_page'),
    ),
  )
  return { source, banks }
}

export function writableFsDescriptors(list) {
  const ids = new Set(list.map((d) => d.param_id))
  const exact = list.filter(
    (d) =>
      activeFsId(d.param_id) === d.param_id || (ids.has(fsModeId) && fsHdrColorBase(d.param_id)),
  )
  try {
    const active = activeFsDescriptors(list)
    return [...exact, ...active.filter((d) => !ids.has(d.param_id))]
  } catch {
    // Serve raw metadata even when an unrelated descriptor conflicts. Exact
    // writes are independently checked against every record for their ID.
    return exact
  }
}

export function matchingDescriptor(list, id) {
  const matches = list.filter((d) => d.param_id === id)
  const first = matches[0]
  if (
    matches.some(
      (d) =>
        semantics(d) !== semantics(first) ||
        Boolean(d.class_names?.includes('readonly')) !==
          Boolean(first.class_names?.includes('readonly')) ||
        /read_only/.test(String(d.param_type)) !== /read_only/.test(String(first.param_type)),
    )
  )
    throw new Error('Conflicting descriptors for ' + id)
  return first
}
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
