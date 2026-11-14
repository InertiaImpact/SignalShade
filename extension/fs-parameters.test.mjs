import test from 'node:test'
import assert from 'node:assert/strict'
import { activeFsDescriptors, fsInputRoute, writableFsDescriptors } from './fs-parameters.js'
import { operation, validateWrite } from './policy.js'
const gain = {
  param_id: 'eParamID_Vid1YUVProcAmpGain_SDI1',
  param_name: 'ProcAmp Gain',
  min_value: 0,
  max_value: 150,
  default_value: 100,
  adjust_by: 1,
  scale_by: 100,
}
test('FS active aliases collapse repeated memories without mixing processors or parameter ranges', () => {
  const list = activeFsDescriptors([
    gain,
    { ...gain },
    { ...gain, param_id: 'eParamID_Vid1YUVProcAmpGain_HDMI' },
    { ...gain, param_id: 'eParamID_Vid2YUVProcAmpGain_SDI2' },
  ])
  assert.deepEqual(
    list.map((d) => d.param_id),
    ['eParamID_Vid1YUVProcAmpGain', 'eParamID_Vid2YUVProcAmpGain'],
  )
  validateWrite({ id: list[0].param_id, value: 110 }, list)
  assert.throws(() => validateWrite({ id: list[0].param_id, value: 151 }, list))
  assert.throws(() => activeFsDescriptors([gain, { ...gain, max_value: 200 }]))
  assert.throws(() =>
    activeFsDescriptors([
      gain,
      { ...gain, param_id: 'eParamID_Vid1YUVProcAmpGain_HDMI', scale_by: 1 },
    ]),
  )
})

test('FS-HDR accepts a valid exact active memory, never status or conflicting definitions', () => {
  const d = {
    ...gain,
    param_name: 'CC Red Gain',
    param_id: 'eParamID_Vid0RGBProcAmpGainRed_SDI1_2_DualLink',
  }
  const bad = { ...d, param_id: 'eParamID_Vid0RGBProcAmpGainRed_SDI3_4_DualLink' }
  const list = writableFsDescriptors([d, bad, { ...bad, max_value: 200 }])
  assert.deepEqual(operation('map.json'), { kind: 'map' })
  validateWrite({ id: d.param_id, value: 110 }, list)
  assert.throws(() => validateWrite({ id: bad.param_id, value: 110 }, list), /Conflicting/)
  const status = { ...d, param_id: d.param_id + '_status_page' }
  assert.throws(() => validateWrite({ id: status.param_id, value: 110 }, [status]))
  const base = 'eParamID_Vid0RGBProcAmpGainRed'
  const route = fsInputRoute(
    {
      forward_maps: {
        [base]: {
          map_scheme: 1,
          depends_on: ['eParamID_Vid0VideoInput'],
          param_maps: [d.param_id, 'eParamID_Vid1RGBProcAmpGainRed_SDI1_2_DualLink'],
        },
      },
    },
    base,
  )
  assert.deepEqual(route.banks, { 0: d.param_id })
})
