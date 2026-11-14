import { afterEach, expect, it, vi } from 'vitest'
import { AjaAdapter } from './aja'

const modeId = 'eParamID_FS4Mode'
const native = (n: number, control: string, suffix = '') => `eParamID_Vid${n}${control}${suffix}`

function fixture(mode: number, conflict = false, identity = 'normal') {
  const input = (n: number) => native(n, 'VideoInput')
  const controls = {
    YUVProcAmpEnable: 'ProcAmp Enable',
    YUVProcAmpGain: 'ProcAmp Gain',
    RGBProcAmpGainRed: 'CC Red Gain',
  }
  const descriptors: Record<string, unknown>[] = [
    { param_id: 'eParamID_ProductID', param_name: 'Product' },
    { param_id: 'eParamID_SoftwareVersion', param_name: 'Software Version' },
    { param_id: modeId, param_name: 'Operating Mode' },
    // Unrelated duplicate definitions must not prevent the FS-HDR color probe.
    { param_id: 'eParamID_Unrelated', max_value: 4 },
    { param_id: 'eParamID_Unrelated', max_value: 8 },
  ]
  const values = new Map<string, string | number>([
    ['eParamID_ProductID', 'FS | HDR'],
    ['eParamID_SoftwareVersion', '4.3.3.3'],
    [modeId, mode],
  ])
  const forward_maps: Record<string, unknown> = {}
  for (const n of [0, 1, 2, 3, 4]) {
    descriptors.push({ param_id: input(n), param_name: 'Video Input' })
    values.set(input(n), 1)
    for (const [control, label] of Object.entries(controls)) {
      const a = native(n, control, '_SDI1_2_DualLink'),
        b = native(n, control, '_SDI3_4_DualLink')
      const base = native(n, control)
      const enable = control.endsWith('Enable')
      const def = {
        param_name: label,
        min_value: 0,
        max_value: enable ? 1 : 150,
        default_value: enable ? 0 : 100,
        adjust_by: 1,
      }
      if (enable) {
        // This status-page descriptor shares the label but must not become a second control.
        descriptors.push({ ...def, param_id: base + '_status_page', class_names: ['readonly'] })
      }
      descriptors.push({ ...def, param_id: base }, { ...def, param_id: a }, { ...def, param_id: b })
      if (conflict && n === 0 && enable) descriptors.push({ ...def, param_id: a, max_value: 2 })
      forward_maps[base] = { map_scheme: 1, depends_on: [input(n)], param_maps: { 1: a, 2: b } }
      values.set(a, enable ? 1 : 105)
      values.set(b, enable ? 0 : 110)
    }
  }
  const writes: string[] = []
  if (identity !== 'normal') {
    descriptors.splice(0, 2)
    values.delete('eParamID_ProductID')
    if (identity !== 'manual') {
      descriptors.push(
        { param_id: 'eParamID_Vid0ColorHDRTransform' },
        { param_id: 'eParamID_Vid0ColorfrontMode' },
      )
    }
    if (identity === 'canonical') values.set('eParamID_ProductID', '123')
    if (identity === 'wrong-model') values.set('eParamID_ProductID', 'FS4')
  }
  const read = vi.fn(async (url: string) => {
    const u = new URL(url),
      id = u.searchParams.get('paramid') ?? ''
    if (u.pathname === '/desc.json') return Response.json(descriptors)
    if (u.pathname === '/map.json') return Response.json({ forward_maps })
    if (id === 'eParamID_ProductID' && identity === 'canonical')
      return Response.json({ name: id, value: '123', value_name: 'FS | HDR' })
    if (!values.has(id)) return new Response('', { status: 404 })
    if (u.searchParams.get('action') === 'set') {
      writes.push(id)
      values.set(id, u.searchParams.get('value')!)
    }
    return Response.json({ name: id, value: values.get(id) })
  })
  vi.stubGlobal('fetch', read)
  return { writes, read, values }
}
afterEach(() => vi.unstubAllGlobals())

it.each([2, 1])(
  'uses the FS-HDR mode (%i) and exact input map, without probing writes',
  async (mode) => {
    const f = fixture(mode),
      adapter = new AjaAdapter('10.0.0.2')
    const report = await adapter.probe()
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
    expect(report.model).toBe('FS-HDR')
    expect(report.firmware).toContain('4.3.3.3')
    expect(report.channels.map((c) => c.id.split('/').at(-1))).toEqual(
      mode === 2 ? ['vid0'] : ['vid1', 'vid2', 'vid3', 'vid4'],
    )
    const ch = report.channels[0],
      n = mode === 2 ? 0 : 1
    expect(ch.values).toEqual({ procEnabled: 1, gain: 105, redGain: 105 })
    expect(f.writes).toEqual([])
    const gain = ch.descriptors.find((d) => d.id === 'gain')!
    expect(await adapter.write(ch, gain, 115)).toBe(115)
    expect(f.writes).toEqual([native(n, 'YUVProcAmpGain', '_SDI1_2_DualLink')])
    f.values.set(native(n, 'VideoInput'), 2)
    await expect(adapter.write(ch, gain, 120)).rejects.toThrow('Source changed')
    const routed = await adapter.read(ch)
    expect(routed.values.gain).toBe(110)
    await adapter.write({ ...ch, ...routed }, gain, 120)
    expect(f.writes[1]).toBe(native(n, 'YUVProcAmpGain', '_SDI3_4_DualLink'))
    f.values.set(modeId, mode === 2 ? 1 : 2)
    await expect(adapter.read(ch)).rejects.toThrow('operating mode changed')
    expect(f.writes).toHaveLength(2)
    adapter.dispose()
  },
)

it('reports a genuine conflict in the selected bank, with its exact ID', async () => {
  const f = fixture(2, true),
    adapter = new AjaAdapter('10.0.0.2')
  const report = await adapter.probe()
  expect(report.channels).toEqual([])
  expect(
    report.checks.some(
      (c) => c.status === 'fail' && c.detail.includes('Vid0YUVProcAmpEnable_SDI1_2_DualLink'),
    ),
  ).toBe(true)
  expect(f.writes).toEqual([])
  adapter.dispose()
})

it.each(['canonical', 'signature', 'manual'])(
  'reaches FS-HDR mapping without identity descriptors or a reachable home page (%s)',
  async (identity) => {
    const f = fixture(2, false, identity),
      adapter = new AjaAdapter('10.0.0.2')
    const report = await adapter.probe(undefined, identity === 'manual' ? 'FS-HDR' : undefined)
    expect(report.model).toBe('FS-HDR')
    expect(report.firmware).toContain('4.3.3.3')
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
    expect(report.channels).toHaveLength(1)
    expect(f.read.mock.calls.map(([url]) => new URL(url).pathname)).toContain('/map.json')
    expect(f.writes).toEqual([])
    adapter.dispose()
  },
)

it('does not assign a model to generic FS descriptors without an HDR signature or explicit choice', async () => {
  const f = fixture(2, false, 'manual'),
    adapter = new AjaAdapter('10.0.0.2')
  const report = await adapter.probe()
  expect(report.model).toBeUndefined()
  expect(report.channels).toHaveLength(0)
  expect(f.read.mock.calls.map(([url]) => new URL(url).pathname)).not.toContain('/map.json')
  adapter.dispose()
})

it('does not override a confirmed different model with an FS-HDR hint', async () => {
  const f = fixture(2, false, 'wrong-model'),
    adapter = new AjaAdapter('10.0.0.2')
  const report = await adapter.probe(undefined, 'FS-HDR')
  expect(report.model).toBe('FS4')
  expect(f.read.mock.calls.map(([url]) => new URL(url).pathname)).not.toContain('/map.json')
  adapter.dispose()
})
