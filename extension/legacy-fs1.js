// Original FS1 2.2.2.1: native parameter ranges from AJA firmware metadata,
// consistent with the 10.1–10.5 ProcAmp controls in its operation guide.
export const fs1ReadIds = [
  'eParamID_VideoInputSelect',
  'eParamID_DetectInputFormat',
  'eParamID_ProcAmpEnable',
  'eParamID_ProcAmpBlackYCGain',
  'eParamID_ProcAmpBlackYCOffset',
  'eParamID_ProcAmpHue',
  'eParamID_ProcAmpSat',
]
export const fs1Descriptors = [
  ['eParamID_ProcAmpEnable', 'ProcAmp Enable', 0, 1, 0, 1, 1],
  ['eParamID_ProcAmpBlackYCGain', 'ProcAmp Gain', 0, 150, 100, 1, 100],
  ['eParamID_ProcAmpBlackYCOffset', 'ProcAmp Black', -200, 200, 0, 5, 10],
  ['eParamID_ProcAmpHue', 'ProcAmp Hue', -180, 180, 0, 1, 1],
  ['eParamID_ProcAmpSat', 'ProcAmp Sat', 0, 150, 100, 1, 100],
].map(([param_id, param_name, min_value, max_value, default_value, adjust_by, scale_by]) => ({
  param_id,
  param_name,
  min_value,
  max_value,
  default_value,
  adjust_by,
  scale_by,
  offset_by: 0,
  ...(param_id === 'eParamID_ProcAmpEnable'
    ? {
        enum_values: [
          { value: 0, text: 'Off' },
          { value: 1, text: 'On' },
        ],
      }
    : {}),
}))
export function isFs1Identity(info) {
  return info?.model === 'FS1' && /\bAJA\b/i.test(info.title ?? '')
}
export function fs1ReadValue(response, id) {
  return (
    response &&
    [response.name, response.param_id, response.paramid].includes(id) &&
    response.value !== null &&
    String(response.value ?? '').trim() !== '' &&
    Number.isFinite(Number(response.value))
  )
}
