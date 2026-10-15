import test from 'node:test'
import assert from 'node:assert/strict'
import { activeFsDescriptors } from './fs-parameters.js'
import { validateWrite } from './policy.js'
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
