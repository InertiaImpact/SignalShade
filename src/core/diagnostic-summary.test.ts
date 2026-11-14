import { expect, it } from 'vitest'
import qrcode from 'qrcode-generator'
import { diagnosticFragment, diagnosticLink, diagnosticSummary } from './diagnostic-summary'

it('reports the current step and pending request before the probe returns', () => {
  const origin = 'http://10.215.20.20'
  const summary = diagnosticSummary(
    {
      reports: {},
      events: [
        { action: 'device-attempt', origin },
        { action: 'add-stage', origin, stage: 'Reading FS-HDR input map' },
      ],
      pending: [
        { origin, path: 'map.json?token=secret' },
        { origin: 'http://10.215.20.21', path: 'device-info' },
      ],
    },
    origin,
    '0.4.2',
    'FS-HDR',
  )
  expect(summary).toContain('Add step: Reading FS-HDR input map')
  expect(summary).toContain('Waiting: map.json')
  expect(summary).not.toMatch(/10\.215|secret|device-info/)
})

it('keeps one bounded, scannable summary of the selected attempt without copying raw data', () => {
  const origin = 'http://10.215.20.123',
    other = 'http://10.215.20.124'
  const capture = {
    reports: {
      [origin]: {
        model: 'FS-HDR',
        firmware: 'FSHDR 4.3.3.3',
        rawDescriptorCount: 1852,
        channels: [],
        rawDescriptors: [{ value: 'mySecret1' }],
        checks: [
          {
            name: 'Ambiguous mapping',
            status: 'fail',
            detail:
              'multiple descriptors match procEnabled (eParamID_Vid0YUVProcAmpEnable_SDI1, eParamID_Vid0YUVProcAmpEnable_SDI2). password=mySecret2',
          },
        ],
      },
    },
    events: [
      { origin, path: 'config?action=get&paramid=eParamID_Unrelated', error: 'timeout' },
      { origin, action: 'device-attempt' },
      { origin, path: 'desc.json', status: 200 },
      { origin, path: 'map.json', status: 200, response: { password: 'mySecret3' } },
      { origin: other, path: 'config?action=get&paramid=eParamID_OtherDevice', error: 'timeout' },
    ],
  }
  const summary = diagnosticSummary(capture, origin, '0.4.2')
  expect(summary).toContain('FS-HDR SW 4.3.3.3')
  expect(summary).toContain(
    'duplicate descriptors procEnabled Vid0YUVProcAmpEnable_SDI1/Vid0YUVProcAmpEnable_SDI2',
  )
  expect(summary).toContain('map.json: 200')
  expect(summary).not.toMatch(/10\.215|mySecret|OtherDevice|Unrelated/)
  expect(summary.length).toBeLessThanOrEqual(450)
  const link = diagnosticLink(summary, 'https://inertiaimpact.github.io/SignalShade/')
  const url = new URL(link)
  expect(url.search).toBe('')
  expect(decodeURIComponent(url.hash.slice(diagnosticFragment.length))).toBe(summary)
  const qr = qrcode(0, 'M')
  qr.addData(link)
  qr.make()
  expect(qr.getModuleCount()).toBeLessThan(100)
})
