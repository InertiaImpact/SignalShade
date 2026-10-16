import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeskStore } from './store'
import { demoWorkspace } from './demo'
import { AjaAdapter } from '../adapters/aja'
import type { ProbeResult, Workspace } from './types'
vi.mock('./persistence', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadWorkspace: vi.fn(async () => undefined),
  saveWorkspace: vi.fn(async () => undefined),
}))
let store: DeskStore
beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => {
        void callback({})
        return Promise.resolve()
      },
    },
  })
  store = new DeskStore()
  await store.initialize()
})
afterEach(() => {
  store.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function settle() {
  await vi.advanceTimersByTimeAsync(5000)
}
const value = (id: string, param = 'gain') =>
  store.getSnapshot().workspace.channels.find((c) => c.id === id)!.values[param as 'gain']
function hardwareFixture() {
  const channel = {
    ...demoWorkspace().channels[0],
    id: 'http://10.0.0.2/vid1',
    deviceId: 'http://10.0.0.2',
  }
  const adapter = {
    read: vi.fn(async () => ({ values: { ...channel.values }, context: channel.context })),
    write: vi.fn(async (_c: unknown, _d: unknown, v: number) => v),
    dispose: vi.fn(),
  } as unknown as AjaAdapter
  const result: ProbeResult = {
    address: channel.deviceId,
    model: 'FS4',
    firmware: 'fixture',
    channels: [channel],
    descriptors: channel.descriptors,
    checks: [],
    rawDescriptorCount: 20,
  }
  store.connect(adapter, result, 'Test hardware')
  store.armDevice(channel.deviceId, true)
  return { channel, adapter }
}
describe('command engine', () => {
  it('keeps processor identity and settings while reading native values after routing changes', async () => {
    const { channel, adapter } = hardwareFixture()
    store.updateChannel(channel.id, { label: 'Wide camera' })
    const gang = { ...store.getSnapshot().workspace.gangs[0], members: [channel.id] }
    store.saveGang(gang)
    const live = { ...channel.values, gain: 1.4, procEnabled: 0 }
    vi.mocked(adapter.read).mockResolvedValue({
      values: live,
      context: 'input-2',
      source: 'SDI 2',
      format: '1080i',
    })
    await store.refresh()
    const after = store.getSnapshot().workspace.channels.find((c) => c.id === channel.id)!
    expect(after).toMatchObject({
      id: channel.id,
      processor: channel.processor,
      label: 'Wide camera',
      context: 'input-2',
      source: 'SDI 2',
      values: live,
    })
    expect(store.getSnapshot().workspace.gangs.find((g) => g.id === gang.id)?.members).toEqual([
      channel.id,
    ])
    expect(adapter.write).not.toHaveBeenCalled()
    expect(store.getSnapshot().busy).toBe(0)
  })
  it('refreshes routed processor values while locked without writing on unlock', async () => {
    const { channel, adapter } = hardwareFixture()
    const live = { ...channel.values, gain: 1.4 }
    vi.mocked(adapter.read).mockResolvedValue({ values: live, context: 'input-2' })
    store.updateChannel(channel.id, { locked: true })
    await store.refresh()
    expect(value(channel.id)).toBe(1.4)
    expect(store.getSnapshot().workspace.channels.find((c) => c.id === channel.id)?.locked).toBe(
      true,
    )
    store.updateChannel(channel.id, { locked: false })
    await store.refresh()
    expect(adapter.write).not.toHaveBeenCalled()
    expect(value(channel.id)).toBe(1.4)
  })
  it('adds model-specific demos without changing existing processors', () => {
    const before = store.getSnapshot().workspace.channels.map((c) => c.id)
    const id = store.addDemoDevice('FS1', 'Demo legacy')!
    const channels = store.getSnapshot().workspace.channels.filter((c) => c.deviceId === id)
    expect(channels).toHaveLength(1)
    expect(channels[0].descriptors.every((d) => d.section === 'Proc amp')).toBe(true)
    expect(
      store
        .getSnapshot()
        .workspace.channels.slice(0, before.length)
        .map((c) => c.id),
    ).toEqual(before)
  })
  it('cancels an edit after a routing change without disconnecting or resetting the processor', async () => {
    const { channel, adapter } = hardwareFixture()
    vi.mocked(adapter.read).mockResolvedValue({
      values: { ...channel.values, gain: 1.4 },
      context: 'input-2',
    })
    store.adjust([channel.id], 'gain', 1.2, 'absolute')
    await settle()
    expect(adapter.write).not.toHaveBeenCalled()
    expect(
      store.getSnapshot().workspace.devices.find((d) => d.id === channel.deviceId),
    ).toMatchObject({ status: 'online', armed: true })
    await store.refresh()
    expect(value(channel.id)).toBe(1.4)
    expect(store.getSnapshot().workspace.channels.find((c) => c.id === channel.id)?.context).toBe(
      'input-2',
    )
  })
  it('enforces the desk lock in the store and preserves saved gang order', async () => {
    store.setControlsLocked(true)
    store.adjust(['demo-ch-1'], 'gain', 1.4, 'absolute')
    await settle()
    expect(value('demo-ch-1')).toBe(1.02)
    store.setControlsLocked(false)
    const before = store.getSnapshot().workspace.gangs.map((g) => g.id)
    store.saveGang({ ...store.getSnapshot().workspace.gangs[0], name: 'Renamed' })
    expect(store.getSnapshot().workspace.gangs.map((g) => g.id)).toEqual(before)
  })
  it('checks a lock engaged during hardware preflight before sending a write', async () => {
    const { channel, adapter } = hardwareFixture()
    vi.mocked(adapter.read).mockImplementationOnce(async () => {
      store.setControlsLocked(true)
      return { values: channel.values, context: channel.context }
    })
    store.adjust([channel.id], 'gain', 1.2, 'absolute')
    await settle()
    expect(adapter.write).not.toHaveBeenCalled()
  })
  it('never resets hidden legalizer settings through the command engine', async () => {
    const before = store.getSnapshot().workspace.channels[0].values['legalizer.white']
    store.reset(['demo-ch-1'], undefined, true)
    await settle()
    expect(
      store
        .getSnapshot()
        .history.flatMap((h) => h.changes)
        .some((c) => c.parameter.startsWith('legalizer.')),
    ).toBe(false)
    expect(store.getSnapshot().workspace.channels[0].values['legalizer.white']).toBe(before)
  })
  it('discards stale refresh results when the workspace is replaced', async () => {
    const { adapter } = hardwareFixture()
    let resolve!: (s: { values: {}; context: string }) => void
    vi.mocked(adapter.read).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const refreshing = store.refresh()
    await store.replaceWorkspace(undefined, 'empty')
    resolve({ values: {}, context: 'obsolete' })
    await refreshing
    expect(store.getSnapshot().workspace.channels).toEqual([])
    expect(store.getSnapshot().workspace.devices).toEqual([])
  })
  it('toggles gang card visibility without reordering groups or changing signal values', () => {
    const before = store.getSnapshot().workspace
    const gang = before.gangs[1]
    store.showGangCard(gang.id, true)
    const shown = store.getSnapshot()
    expect(shown.workspace.gangs.map((g) => g.id)).toEqual(before.gangs.map((g) => g.id))
    expect(shown.workspace.gangs[1]).toEqual({ ...gang, showAsCard: true })
    expect(shown.workspace.channels).toBe(before.channels)
    expect(shown.history).toHaveLength(0)
    expect(shown.busy).toBe(0)
    store.saveGang({ ...shown.workspace.gangs[1], name: 'Renamed gang' })
    expect(store.getSnapshot().workspace.gangs.find((g) => g.id === gang.id)?.showAsCard).toBe(true)
    store.showGangCard(gang.id, false)
    expect(store.getSnapshot().workspace.gangs.find((g) => g.id === gang.id)?.showAsCard).toBe(
      false,
    )
  })
  it('applies one relative adjustment per unique member and preserves offsets', async () => {
    store.adjust(['demo-ch-1', 'demo-ch-2', 'demo-ch-1'], 'gain', 0.02, 'relative')
    await settle()
    expect(value('demo-ch-1')).toBe(1.04)
    expect(value('demo-ch-2')).toBe(1)
    expect(value('demo-ch-3')).toBe(1)
    expect(store.getSnapshot().history[0].changes).toHaveLength(2)
  })
  it('sets absolute values and independently clamps per member', async () => {
    store.adjust(['demo-ch-1', 'demo-ch-2'], 'gain', 0.49, 'relative')
    await settle()
    expect(value('demo-ch-1')).toBe(1.5)
    expect(value('demo-ch-2')).toBe(1.47)
    expect(store.getSnapshot().activities.some((a) => a.text.includes('limited'))).toBe(true)
    store.adjust(['demo-ch-1', 'demo-ch-2'], 'gain', 1, 'absolute')
    await settle()
    expect(value('demo-ch-1')).toBe(1)
    expect(value('demo-ch-2')).toBe(1)
  })
  it('accumulates fast nudges and makes a slider gesture one undo entry', async () => {
    for (let i = 0; i < 10; i++)
      store.adjust(['demo-ch-1'], 'gain', 0.01, 'relative', 'one-gesture')
    await settle()
    expect(value('demo-ch-1')).toBe(1.12)
    expect(store.getSnapshot().history).toHaveLength(1)
    store.undo()
    await settle()
    expect(value('demo-ch-1')).toBe(1.02)
  })
  it('rejects incompatible preset units before sending any commands', () => {
    store.savePreset('Camera look', ['demo-ch-1'])
    const preset = structuredClone(store.getSnapshot().workspace.presets[0])
    const gain = preset.channels[0].descriptors.find((d) => d.id === 'gain')!
    gain.unit = 'different unit'
    expect(() => store.recallPreset(preset, { 'demo-ch-1': 'demo-ch-9' }, ['Proc amp'])).toThrow(
      'Incompatible parameter semantics',
    )
    expect(store.getSnapshot().busy).toBe(0)
  })
  it('resets one channel while preserving enable states', async () => {
    store.reset(['demo-ch-1'])
    await settle()
    expect(value('demo-ch-1')).toBe(1)
    expect(value('demo-ch-1', 'procEnabled')).toBe(1)
    expect(value('demo-ch-2')).toBe(0.98)
    store.reset(['demo-ch-1'], undefined, true)
    await settle()
    expect(value('demo-ch-1', 'procEnabled')).toBe(0)
  })
  it('blocks locked members and incompatible group parameters', async () => {
    store.updateChannel('demo-ch-1', { locked: true })
    store.adjust(['demo-ch-1'], 'gain', 1.2, 'absolute')
    await settle()
    expect(value('demo-ch-1')).toBe(1.02)
    expect(store.getSnapshot().activities[0].type).toBe('error')
  })
  it('resets a masked gang as one undo operation and preserves unmasked values', async () => {
    store.reset(['demo-ch-1', 'demo-ch-2'], undefined, false, ['gain'])
    await settle()
    expect(value('demo-ch-1')).toBe(1)
    expect(value('demo-ch-1', 'saturation')).toBe(1.05)
    expect(store.getSnapshot().history).toHaveLength(1)
    expect(store.getSnapshot().history[0].changes).toHaveLength(2)
    store.undo()
    await settle()
    expect(value('demo-ch-1')).toBe(1.02)
    expect(value('demo-ch-2')).toBe(0.98)
  })
  it('loads workspace data without automatically enabling hardware writes', async () => {
    const w = demoWorkspace()
    w.devices[0].simulated = false
    w.devices[0].armed = true
    w.devices[0].address = 'http://10.0.0.2'
    await store.replaceWorkspace(w, 'import')
    expect(store.getSnapshot().workspace.devices[0]).toMatchObject({
      status: 'offline',
      armed: false,
    })
    expect(store.getSnapshot().workspace.channels[0].updatedAt).toBe(0)
  })
  it('preflights preset recalls before any command is sent', async () => {
    store.savePreset('Camera look', ['demo-ch-1'])
    const preset = store.getSnapshot().workspace.presets[0]
    store.recallPreset(preset, { 'demo-ch-1': 'demo-ch-9' }, ['Proc amp'])
    await settle()
    expect(value('demo-ch-9')).toBe(1.02)
    expect(store.getSnapshot().busy).toBe(0)
    store.adjust(['demo-ch-1'], 'gain', 1.3, 'absolute')
    await settle()
    store.recallPreset(preset, { 'demo-ch-1': 'demo-ch-1' }, ['Proc amp'])
    await settle()
    expect(value('demo-ch-1')).toBe(1.02)
  })
  it('does not overwrite an externally changed value during undo', async () => {
    const { channel, adapter } = hardwareFixture()
    store.adjust([channel.id], 'gain', 1.1, 'absolute')
    await settle()
    vi.mocked(adapter.read).mockResolvedValue({
      values: { ...channel.values, gain: 1.2 },
      context: channel.context,
    })
    store.undo()
    await settle()
    expect(adapter.write).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().activities.some((a) => a.text.includes('Undo conflict'))).toBe(true)
  })
  it('discards queued writes and locks hardware after an uncertain write', async () => {
    const { channel, adapter } = hardwareFixture()
    vi.mocked(adapter.write).mockRejectedValue(new Error('Network failed after send'))
    store.adjust([channel.id], 'gain', 1.1, 'absolute')
    store.adjust([channel.id], 'black', 1, 'absolute')
    await settle()
    expect(adapter.write).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().busy).toBe(0)
    expect(
      store.getSnapshot().workspace.devices.find((d) => d.id === channel.deviceId),
    ).toMatchObject({ armed: false, status: 'offline' })
    expect(store.getSnapshot().workspace.channels.find((c) => c.id === channel.id)?.pending).toBe(
      false,
    )
  })
  it('qualifies stale context again before writing', async () => {
    const { channel, adapter } = hardwareFixture()
    vi.mocked(adapter.read).mockResolvedValue({
      values: channel.values,
      context: 'different-source',
    })
    store.adjust([channel.id], 'gain', 1.1, 'absolute')
    await settle()
    expect(adapter.write).not.toHaveBeenCalled()
  })
  it('can retain 32 channels without losing group targets', async () => {
    const w: Workspace = demoWorkspace()
    w.channels = Array.from({ length: 32 }, (_, i) => ({
      ...structuredClone(w.channels[0]),
      id: `demo-ch-${i + 1}`,
    }))
    w.gangs = []
    await store.replaceWorkspace(w, 'import')
    store.adjust(
      w.channels.map((c) => c.id),
      'gain',
      0.01,
      'relative',
    )
    await settle()
    expect(store.getSnapshot().workspace.channels.every((c) => c.values.gain === 1.03)).toBe(true)
    expect(store.getSnapshot().busy).toBe(0)
  })
})
