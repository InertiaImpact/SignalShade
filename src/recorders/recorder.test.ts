import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AjaRecorderAdapter,
  groupMedia,
  mediaMetric,
  parameterResponse,
  transportState,
} from './aja'
import { RecorderStore } from './store'
import { demoRecorder, DemoRecorderAdapter } from './demo'
import {
  disconnected,
  recorderModels,
  recorderWarnings,
  type RecorderAdapter,
  type RecorderConfig,
  type RecorderSnapshot,
} from './types'
import { validateWorkspace } from '../core/persistence'
import { emptyWorkspace } from '../core/demo'

const config: RecorderConfig = {
  id: 'test',
  label: 'Program',
  model: 'HELO',
  address: 'http://10.0.0.2',
  simulated: false,
  warningMinutes: 15,
}
const snapshot = (state: RecorderSnapshot['state'] = 'idle'): RecorderSnapshot => ({
  ...disconnected(),
  state,
  updatedAt: Date.now(),
  canControl: true,
  enabled: false,
})
let store: RecorderStore
let allowed = true
beforeEach(() => {
  vi.useFakeTimers()
  allowed = true
  store = new RecorderStore(() => allowed, vi.fn())
  store.sync([config])
})
afterEach(() => {
  store.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function fixture(model: RecorderConfig['model'] = 'HELO') {
  let state: RecorderSnapshot['state'] = 'idle'
  store.sync([{ ...config, model }])
  const adapter: RecorderAdapter = {
    read: vi.fn(async () => snapshot(state)),
    command: vi.fn(async (action) => {
      state = action === 'record' ? 'recording' : 'idle'
    }),
    dispose: vi.fn(),
  }
  store.attach(config.id, adapter)
  await store.refresh(config.id)
  store.enable(config.id, true)
  return {
    adapter,
    setState: (next: typeof state) => {
      state = next
    },
  }
}
describe('recorder command lifecycle', () => {
  it('automatically recovers monitoring and the chosen control state after a transient poll failure', async () => {
    const { adapter } = await fixture()
    vi.mocked(adapter.read).mockRejectedValueOnce(new Error('Temporary network loss'))
    await store.refresh('test')
    expect(store.getSnapshot().test).toMatchObject({ state: 'offline', enabled: false })
    await vi.advanceTimersByTimeAsync(5000)
    await store.tick()
    expect(store.getSnapshot().test).toMatchObject({
      state: 'idle',
      enabled: true,
      issue: undefined,
    })
    expect(adapter.command).not.toHaveBeenCalled()
  })
  it('restores control intent within the tab only after fresh verified state', async () => {
    const data = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => data.get(key),
      setItem: (key: string, value: string) => data.set(key, value),
    })
    const { adapter } = await fixture()
    store.attach('test', adapter)
    expect(store.getSnapshot().test.enabled).toBe(false)
    await store.refresh('test')
    expect(store.getSnapshot().test.enabled).toBe(true)
    store.enable('test', false)
    store.attach('test', adapter)
    await store.refresh('test')
    expect(store.getSnapshot().test.enabled).toBe(false)
    expect(adapter.command).not.toHaveBeenCalled()
  })
  it('remembers only successful connections for automatic monitoring', async () => {
    const remembered = vi.fn()
    const other = new RecorderStore(() => true, vi.fn(), remembered)
    const demo = demoRecorder('HELO')
    other.sync([demo])
    await other.connect(demo)
    expect(remembered).toHaveBeenCalledWith(demo.id)
    other.dispose()
  })
  it('starts monitor-only, never records on connect, and confirms explicit record/stop', async () => {
    const adapter = new DemoRecorderAdapter()
    store.attach(config.id, adapter)
    await store.refresh(config.id)
    expect(store.getSnapshot().test.enabled).toBe(false)
    await store.command('test', 'record')
    expect(store.getSnapshot().test.state).toBe('idle')
    store.enable('test', true)
    await store.command('test', 'record')
    expect(store.getSnapshot().test.state).toBe('recording')
    const id = store.getSnapshot().test.recordingId
    await store.command('test', 'stop', id)
    expect(store.getSnapshot().test.state).toBe('idle')
    expect(store.pending).toBe(false)
  })
  it('suppresses double clicks and respects a lock changed during preflight', async () => {
    const { adapter } = await fixture()
    const action = store.command('test', 'record')
    const duplicate = store.command('test', 'record')
    allowed = false
    await Promise.all([action, duplicate])
    expect(adapter.command).not.toHaveBeenCalled()
    expect(store.pending).toBe(false)
  })
  it('waits for an in-flight poll rather than silently dropping a click', async () => {
    const { adapter } = await fixture()
    let resolve!: (s: RecorderSnapshot) => void
    vi.mocked(adapter.read).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const poll = store.refresh('test')
    const action = store.command('test', 'record')
    expect(store.pending).toBe(true)
    resolve(snapshot())
    await Promise.all([poll, action])
    expect(adapter.command).toHaveBeenCalledExactlyOnceWith('record')
  })
  it('does not replay ambiguous commands even if status reconciles', async () => {
    const { adapter, setState } = await fixture()
    vi.mocked(adapter.command).mockImplementation(async () => {
      setState('recording')
      throw new Error('Timeout')
    })
    await store.command('test', 'record')
    expect(adapter.command).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().test).toMatchObject({
      state: 'recording',
      enabled: false,
      issue: 'Timeout',
    })
    await store.refresh('test')
    expect(store.getSnapshot().test.enabled).toBe(false)
  })
  it('sends a second Ki Pro stop only after confirmed paused state', async () => {
    const { adapter, setState } = await fixture('Ki Pro Ultra')
    setState('recording')
    await store.refresh('test')
    const id = store.getSnapshot().test.recordingId
    let stops = 0
    vi.mocked(adapter.command).mockImplementation(async () => {
      setState(++stops === 1 ? 'paused' : 'idle')
    })
    const action = store.command('test', 'stop', id)
    await vi.advanceTimersByTimeAsync(5000)
    await action
    expect(adapter.command).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().test.state).toBe('idle')
  })
  it('does not double-stop HELO or replay an unconfirmed transition', async () => {
    const { adapter, setState } = await fixture()
    setState('recording')
    await store.refresh('test')
    vi.mocked(adapter.command).mockImplementation(async () => setState('paused'))
    const action = store.command('test', 'stop', store.getSnapshot().test.recordingId)
    await vi.advanceTimersByTimeAsync(5000)
    await action
    expect(adapter.command).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().test.enabled).toBe(false)
  })
  it('rejects an obsolete stop confirmation and never starts from playback', async () => {
    const { adapter, setState } = await fixture()
    setState('recording')
    await store.refresh('test')
    await store.command('test', 'stop', 'old-recording')
    expect(adapter.command).not.toHaveBeenCalled()
    setState('playback')
    await store.refresh('test')
    store.enable('test', true)
    await store.command('test', 'record')
    expect(adapter.command).not.toHaveBeenCalled()
  })
  it('discards late polls after disconnect and freezes the last duration on failure', async () => {
    const { adapter } = await fixture()
    vi.mocked(adapter.read).mockResolvedValueOnce({
      ...snapshot('recording'),
      duration: '00:10:00',
    })
    await store.refresh('test')
    vi.mocked(adapter.read).mockRejectedValueOnce(new Error('Network lost'))
    await store.refresh('test')
    expect(store.getSnapshot().test).toMatchObject({
      state: 'offline',
      duration: '00:10:00',
      enabled: false,
    })
    let resolve!: (s: RecorderSnapshot) => void
    vi.mocked(adapter.read).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const pending = store.refresh('test')
    store.dispose()
    resolve(snapshot('recording'))
    await pending
    expect(store.getSnapshot()).toEqual({})
  })
})
describe('recorder protocol and persistence', () => {
  it('discovers HELO Plus using its observed Product ID and Installed descriptors', async () => {
    // Minimal descriptor fields from the supplied HELO Plus export; no device settings or secrets.
    const descriptors = [
      { param_id: 'eParamID_ProductID', param_name: 'Product ID' },
      { param_id: 'eParamID_CurrentlyRunningImageVersion', param_name: 'Installed' },
      {
        param_id: 'eParamID_ReplicatorRecordState',
        enum_values: [
          { value: 1, text: 'eRRSIdle' },
          { value: 2, text: 'eRRSRecording' },
        ],
      },
      {
        param_id: 'eParamID_ReplicatorCommand',
        enum_values: [
          { value: 1, text: 'Record Command' },
          { value: 2, text: 'Stop Recording Command' },
        ],
      },
    ]
    const fetcher = vi.fn(async (url: string) => {
      const uri = new URL(url)
      const id = uri.searchParams.get('paramid')
      return {
        ok: true,
        json: async () =>
          uri.pathname === '/desc.json'
            ? descriptors
            : {
                paramid: '2097225226',
                name: id,
                value:
                  id === 'eParamID_ProductID'
                    ? 'HELO-PLUS'
                    : id === 'eParamID_CurrentlyRunningImageVersion'
                      ? 'test-version'
                      : '1',
              },
      }
    })
    vi.stubGlobal('fetch', fetcher)
    const adapter = new AjaRecorderAdapter({ ...config, model: 'HELO Plus' })
    expect(await adapter.read(false)).toMatchObject({
      state: 'idle',
      canControl: true,
      firmware: 'test-version',
    })
    expect(fetcher.mock.calls.every(([url]) => !url.includes('action=set'))).toBe(true)
    adapter.dispose()
    const wrongModel = new AjaRecorderAdapter({ ...config, model: 'HELO' })
    expect((await wrongModel.read(false)).canControl).toBe(false)
    wrongModel.dispose()
  })
  it('identifies the failing endpoint when the browser cannot read a response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const adapter = new AjaRecorderAdapter(config)
    await expect(adapter.read(false)).rejects.toThrow(
      'Browser could not read recorder response: desc.json',
    )
    adapter.dispose()
  })
  it('matches symbolic names alongside numeric IDs and rejects unrelated responses', () => {
    expect(
      parameterResponse(
        { paramid: '2097225226', name: 'eParamID_ReplicatorRecordState', value: '2' },
        'eParamID_ReplicatorRecordState',
      ).value,
    ).toBe('2')
    expect(() =>
      parameterResponse({ name: 'wrong', value: 2 }, 'eParamID_TransportState'),
    ).toThrow()
    expect(transportState(3, true)).toBe('error')
    expect(transportState(15, false)).toBe('paused')
  })
  it('preserves missing metrics, groups slots, and only normalizes explicit units', () => {
    const metric = (label: string, value: unknown, units = '') =>
      mediaMetric({ param_id: label, param_name: label, units }, { value }, Date.now())
    expect(metric('USB Free', '').freeBytes).toBeUndefined()
    expect(metric('SD Time Remaining', 120, 'seconds').remainingSeconds).toBe(120)
    expect(metric('SD Time Remaining', 120).remainingSeconds).toBeUndefined()
    const grouped = groupMedia([
      metric('USB 1 Free', 20, 'GB'),
      metric('USB 1 Status', 'Ready'),
      metric('USB 2 Status', 'Full'),
    ])
    expect(grouped).toHaveLength(2)
    expect(grouped[0]).toMatchObject({ status: 'Ready', freeBytes: 20e9 })
    expect(recorderWarnings({ ...snapshot(), media: grouped }, config)).toContain('USB 2: Full')
  })
  it('imports old workspaces and strips runtime control/credentials from recorder configuration', () => {
    expect(validateWorkspace(emptyWorkspace()).recorders).toBeUndefined()
    const imported = validateWorkspace({
      ...emptyWorkspace(),
      recorders: [{ ...config, enabled: true, password: 'secret', state: 'recording' }],
    })
    expect(imported.recorders).toEqual([config])
    expect(() =>
      validateWorkspace({ ...emptyWorkspace(), recorders: [config, { ...config, id: 'second' }] }),
    ).toThrow('Duplicate')
    expect(() =>
      validateWorkspace({
        ...emptyWorkspace(),
        recorders: [{ ...config, address: 'https://example.com' }],
      }),
    ).toThrow()
    expect(
      validateWorkspace({ ...emptyWorkspace(), recorders: [demoRecorder()] }).recorders,
    ).toHaveLength(1)
  })
  it.each(recorderModels)(
    'uses verified %s commands, cookie auth, and optional media failure isolation',
    async (model) => {
      const helo = model.startsWith('HELO')
      const stateId = helo ? 'eParamID_ReplicatorRecordState' : 'eParamID_TransportState'
      const commandId = helo ? 'eParamID_ReplicatorCommand' : 'eParamID_TransportCommand'
      const descriptors = [
        { param_id: 'eParamID_ProductName', param_name: 'Product Name' },
        {
          param_id: stateId,
          enum_values: [
            { value: 1, text: 'Idle' },
            { value: 2, text: 'Recording' },
          ],
        },
        {
          param_id: commandId,
          enum_values: [
            { value: helo ? 1 : 3, text: 'Record Command' },
            { value: helo ? 2 : 4, text: helo ? 'Stop Recording Command' : 'Stop Command' },
          ],
        },
        {
          param_id: 'eParamID_CurrentMediaAvailable',
          param_name: 'Current Media Available',
          units: '%',
        },
        { param_id: 'eParamID_USBStatus', param_name: 'USB Status' },
      ]
      const fetcher = vi.fn(async (url: string) => {
        const uri = new URL(url)
        const id = uri.searchParams.get('paramid')
        if (id === 'eParamID_USBStatus') throw new Error('Missing media')
        return {
          ok: true,
          json: async () =>
            uri.pathname === '/authenticator/login'
              ? { login: 'success' }
              : uri.pathname === '/desc.json'
                ? descriptors
                : {
                    paramid: '12345',
                    name: id,
                    value: id === 'eParamID_ProductName' ? model : id === stateId ? '1' : '75',
                  },
        }
      })
      vi.stubGlobal('fetch', fetcher)
      const adapter = new AjaRecorderAdapter({ ...config, model }, 'password')
      const result = await adapter.read(true)
      expect(result.canControl).toBe(true)
      expect(result.state).toBe('idle')
      expect(result.media.find((m) => m.label === 'USB')?.warnings).toContain('Read failed')
      expect(fetcher.mock.calls.every(([url]) => !url.includes('action=set'))).toBe(true)
      await adapter.command('record')
      await adapter.command('stop')
      const writes = fetcher.mock.calls
        .filter(([url]) => url.includes('action=set'))
        .map(([url]) => new URL(url).searchParams.get('value'))
      expect(writes).toEqual(helo ? ['1', '2'] : ['3', '4'])
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringContaining('authenticator/login'),
        expect.objectContaining({ credentials: 'include', method: 'POST' }),
      )
      adapter.dispose()
    },
  )
})
