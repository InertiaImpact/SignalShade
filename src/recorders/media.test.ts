import { afterEach, expect, it, vi } from 'vitest'
import descriptors from '../adapters/fixtures/helo-plus-media.json'
import { AjaRecorderAdapter } from './aja'
import { recorderWarnings, type RecorderConfig } from './types'
const config: RecorderConfig = {
  id: 'helo',
  label: 'Program record',
  model: 'HELO Plus',
  address: 'http://10.0.0.2',
  simulated: false,
  warningMinutes: 15,
}
afterEach(() => vi.unstubAllGlobals())
it('shows HELO main/backup and actual slots without polling unrelated destination or clip controls', async () => {
  const calls: string[] = []
  const values: Record<string, unknown> = {
    eParamID_ReplicatorRecordState: 2,
    eParamID_RecordingDuration: '00:00:03:09',
    eParamID_RecordingDestination: 2,
    eParamID_SecondaryRecordingDestination: 4,
    eParamID_CurrentMediaMounted: 1,
    eParamID_CurrentMediaAvailable: 50,
    eParamID_CurrentMediaUnusedBytes: '5000000000',
    eParamID_CurrentMediaTotalBytes: '10000000000',
    eParamID_SecondaryMediaMounted: 0,
    eParamID_MediaState: 0,
    eParamID_SL_SD_Status: 'Empty',
    eParamID_SL_USB_Status: 'Empty',
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const u = new URL(url),
        id = u.searchParams.get('paramid')!
      if (u.pathname === '/desc.json')
        return new Response(
          JSON.stringify([
            ...descriptors,
            { param_id: 'eParamID_RTPDestinationURL', param_name: 'RTP-TS Destination URL' },
            {
              param_id: 'eParamID_ClipToDeleteBackup',
              param_name: 'Clip to be deleted on backup recording destination',
            },
            { param_id: 'eParamID_MediaManagerState', param_name: 'Media Manager State' },
          ]),
        )
      return new Response(
        JSON.stringify({
          name: id,
          value: values[id] ?? '',
          ...(id === 'eParamID_MediaState' ? { value_name: 'Record-Stream' } : {}),
        }),
      )
    }),
  )
  const adapter = new AjaRecorderAdapter(config),
    s = await adapter.read(true)
  expect(s.state).toBe('recording')
  expect(s.duration).toBe('00:00:03:09')
  expect(s.media).toHaveLength(4)
  expect(s.media.find((m) => m.id === 'main')).toMatchObject({
    label: 'Main · SMB Network Share',
    status: 'Ready',
    freeBytes: 5e9,
    totalBytes: 1e10,
    freePercent: 50,
  })
  expect(s.media.find((m) => m.id === 'backup')?.status).toBe('Not configured')
  expect(s.media.find((m) => m.label === 'SD')?.status).toBe('Not inserted')
  expect(recorderWarnings(s, config)).toEqual([])
  expect(
    calls.filter((c) => c.includes('paramid=')).some((c) => /URL|ClipToDelete|Manager/.test(c)),
  ).toBe(false)
  expect(calls.length).toBeLessThan(24)
  adapter.dispose()
})
