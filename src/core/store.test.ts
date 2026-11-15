import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeskStore } from './store'
import { demoWorkspace } from './demo'
import { AjaAdapter } from '../adapters/aja'
import { loadWorkspace, originalWorkspaceId, saveWorkspace, validateWorkspace } from './persistence'
import { cardsInView, customViewKey, gangViewKey } from './views'
import type { ProbeResult, Workspace } from './types'
import { subscribeStageAdjustments } from './stages'
import { subscribeDemoChanges } from './demo-feedback'
vi.mock('./persistence', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadWorkspace: vi.fn(async () => undefined),
  saveWorkspace: vi.fn(async () => undefined),
}))
let store: DeskStore
beforeEach(async () => {
  vi.useFakeTimers()
  const session = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => session.set(key, value),
    removeItem: (key: string) => session.delete(key),
  })
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
  vi.restoreAllMocks()
})
async function settle() {
  await vi.advanceTimersByTimeAsync(5000)
}
const value = (id: string, param = 'gain') =>
  store.getSnapshot().workspace.channels.find((c) => c.id === id)!.values[param as 'gain']
const stored = (workspace: Workspace) => ({
  active: originalWorkspaceId,
  entries: [{ id: originalWorkspaceId, workspace }],
})
function hardwareFixture(address = 'http://10.0.0.2', arm = true) {
  const channel = {
    ...demoWorkspace().channels[0],
    id: `${address}/vid1`,
    deviceId: address,
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
  if (arm) store.armDevice(channel.deviceId, true)
  return { channel, adapter, result }
}
describe('command engine', () => {
  it('keeps resized spacers and their order local to a view through workspace export', () => {
    const channel = store.getSnapshot().workspace.channels[0]
    const view = customViewKey('spacer-test')
    store.saveView({ id: 'spacer-test', name: 'Production', cards: [channel.id] })
    store.addViewSpacer(view, 'card', 30)
    store.addViewSpacer(view, 'bar', 30)
    const [card, bar] = store.getSnapshot().workspace.viewSpacers![view]
    store.resizeViewSpacer(view, card.id, { columns: 2, height: 2 })
    store.moveViewCard(view, bar.id, channel.id)
    const restored = validateWorkspace(JSON.parse(JSON.stringify(store.getSnapshot().workspace)))
    expect(cardsInView(restored, view)).toEqual([bar.id, channel.id, card.id])
    expect(cardsInView(restored, 'all')).not.toContain(card.id)
    expect(restored.viewSpacers?.[view]).toEqual([{ ...card, columns: 2, height: 2 }, bar])
    store.removeViewSpacer(view, card.id)
    expect(cardsInView(store.getSnapshot().workspace, view)).toEqual([bar.id, channel.id])
  })
  it('keeps card orders independent and restores the selected workspace and its views', async () => {
    const initial = store.getSnapshot()
    const gang = initial.workspace.gangs[0]
    const [first, second] = initial.workspace.channels
    const groupView = gangViewKey(gang.id)
    const customView = customViewKey('production')
    expect(cardsInView(initial.workspace, groupView)[0]).toBe(gang.id)
    store.saveView({ id: 'production', name: 'Production', cards: [second.id, gang.id, first.id] })
    store.moveViewCard(groupView, gang.id, first.id)
    store.moveViewCard('all', second.id, first.id)
    store.moveViewCard(customView, gang.id, first.id)
    expect(cardsInView(store.getSnapshot().workspace, groupView)[0]).toBe(first.id)
    expect(cardsInView(store.getSnapshot().workspace, 'all')[0]).toBe(second.id)
    expect(cardsInView(store.getSnapshot().workspace, customView)).toEqual([
      second.id,
      first.id,
      gang.id,
    ])
    await store.addWorkspace(undefined, 'empty', 'Remote truck')
    const secondId = store.getSnapshot().workspaceId
    expect(store.getSnapshot().workspace.channels).toHaveLength(0)
    const saved = vi.mocked(saveWorkspace).mock.calls.at(-1)![0]
    vi.mocked(loadWorkspace).mockResolvedValueOnce(saved)
    store.dispose()
    store = new DeskStore()
    await store.initialize()
    expect(store.getSnapshot().workspaceId).toBe(secondId)
    await store.switchWorkspace(initial.workspaceId)
    expect(cardsInView(store.getSnapshot().workspace, customView)).toEqual([
      second.id,
      first.id,
      gang.id,
    ])
    store.deleteGang(gang.id)
    expect(cardsInView(store.getSnapshot().workspace, customView)).toEqual([second.id, first.id])
  })

  it('restores saved processors independently after reload and restores writes only on a fresh match', async () => {
    const first = hardwareFixture()
    const changed = hardwareFixture('http://10.0.0.3')
    const offline = hardwareFixture('http://10.0.0.4')
    const locked = hardwareFixture('http://10.0.0.5', false)
    store.updateChannel(first.channel.id, { label: 'Camera 6', locked: true })
    const saved = store.getSnapshot().workspace
    const devices = [first, changed, offline, locked]
    const probe = vi.spyOn(AjaAdapter.prototype, 'probe').mockImplementation(async function (
      this: AjaAdapter,
    ) {
      const fixture = devices.find((d) => d.result.address === this.address)!
      if (fixture === offline) throw new Error('Unit offline')
      return {
        ...fixture.result,
        firmware: fixture === changed ? 'changed' : fixture.result.firmware,
        channels: [
          {
            ...fixture.channel,
            updatedAt: Date.now(),
            context: 'input-2',
            values: { ...fixture.channel.values, gain: 1.3 },
          },
        ],
      }
    })
    const write = vi.spyOn(AjaAdapter.prototype, 'write')
    vi.mocked(loadWorkspace).mockResolvedValueOnce(stored(saved))
    store.dispose()
    store = new DeskStore()
    await store.initialize()

    const restored = store.getSnapshot().workspace
    expect(probe).toHaveBeenCalledTimes(4)
    expect(write).not.toHaveBeenCalled()
    expect(restored.devices.slice(-4).map((d) => [d.status, d.armed])).toEqual([
      ['online', true],
      ['online', false],
      ['offline', false],
      ['online', false],
    ])
    expect(restored.channels.map((channel) => channel.id)).toEqual(
      saved.channels.map((channel) => channel.id),
    )
    expect(restored.channels.find((channel) => channel.id === first.channel.id)).toMatchObject({
      label: 'Camera 6',
      locked: true,
      context: 'input-2',
      values: { gain: 1.3 },
    })
  })

  it('restores a desk lock and leaves a write interrupted by reload disarmed', async () => {
    const { channel, result, adapter } = hardwareFixture()
    const saved = store.getSnapshot().workspace
    vi.mocked(adapter.write).mockImplementationOnce(() => new Promise(() => {}))
    expect(store.adjust([channel.id], 'gain', 1.2, 'absolute')).toBe(true)
    await settle()
    expect(adapter.write).toHaveBeenCalledOnce()
    store.setControlsLocked(true)
    vi.mocked(loadWorkspace).mockResolvedValueOnce(stored(saved))
    vi.spyOn(AjaAdapter.prototype, 'probe').mockResolvedValue({
      ...result,
      channels: [{ ...channel, updatedAt: Date.now() }],
    })
    const write = vi.spyOn(AjaAdapter.prototype, 'write')
    store.dispose()
    store = new DeskStore()
    await store.initialize()
    expect(store.getSnapshot().controlsLocked).toBe(true)
    expect(store.getSnapshot().busy).toBe(0)
    expect(store.getSnapshot().workspace.devices.at(-1)).toMatchObject({
      status: 'online',
      armed: false,
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('connects and reconnects hardware without enabling writes', async () => {
    const { channel, adapter, result } = hardwareFixture(undefined, false)
    const device = () =>
      store.getSnapshot().workspace.devices.find((d) => d.id === channel.deviceId)
    expect(device()).toMatchObject({ status: 'online', armed: false })
    await store.refresh()
    store.adjust([channel.id], 'gain', 1.2, 'absolute')
    await settle()
    expect(adapter.write).not.toHaveBeenCalled()
    store.armDevice(channel.deviceId, true)
    store.connect(adapter, result, 'Test hardware')
    expect(device()?.armed).toBe(false)
    expect(adapter.write).not.toHaveBeenCalled()
  })

  it('keeps devices with no verified controls in monitoring mode', () => {
    const { channel, adapter, result } = hardwareFixture(undefined, false)
    store.connect(
      adapter,
      { ...result, descriptors: [], channels: [{ ...channel, descriptors: [], values: {} }] },
      'Monitor',
    )
    expect(() => store.armDevice(channel.deviceId, true)).toThrow('monitoring only')
    expect(adapter.write).not.toHaveBeenCalled()
  })
  it('waits for every device read to settle after a failed Converge preflight', async () => {
    const first = hardwareFixture(),
      second = hardwareFixture('http://10.0.0.3')
    let finishRead!: (value: { values: typeof second.channel.values; context: string }) => void
    vi.mocked(first.adapter.read).mockRejectedValueOnce(new Error('Read failed'))
    vi.mocked(second.adapter.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve
        }),
    )
    const step = store.converge([first.channel.id, second.channel.id], 'large')
    await Promise.resolve()
    expect(store.getSnapshot().converging).toBe(true)
    finishRead({ values: second.channel.values, context: second.channel.context })
    await step
    expect(store.getSnapshot().converging).toBe(false)
    expect(first.adapter.write).not.toHaveBeenCalled()
    expect(second.adapter.write).not.toHaveBeenCalled()
  })
  it('keeps the target stable during pending writes and respects per-member reset masks', async () => {
    store.setConvergeTarget('demo-ch-3')
    store.adjust(['demo-ch-1'], 'gain', 0.1, 'relative')
    store.setConvergeTarget('demo-ch-1')
    expect(store.getSnapshot().workspace.convergeTargetId).toBe('demo-ch-3')
    await settle()
    const gain2 = value('demo-ch-2')
    store.reset(['demo-ch-1', 'demo-ch-2'], undefined, false, undefined, {
      'demo-ch-1': ['gain'],
      'demo-ch-2': ['black'],
    })
    await settle()
    expect(value('demo-ch-1')).toBe(1)
    expect(value('demo-ch-2')).toBe(gain2)
    expect(value('demo-ch-2', 'black')).toBe(0)
  })
  it('reads a golden hardware camera freshly even when its write controls are locked', async () => {
    const { channel, adapter } = hardwareFixture()
    store.armDevice(channel.deviceId, false)
    store.updateChannel(channel.id, { locked: true })
    store.setConvergeTarget(channel.id)
    vi.mocked(adapter.read).mockResolvedValue({
      values: { ...channel.values, gain: 0.5 },
      context: channel.context,
    })
    await store.converge(['demo-ch-1', 'demo-ch-2'], 'large', {
      'demo-ch-1': ['gain'],
      'demo-ch-2': ['gain'],
    })
    await settle()
    expect(adapter.read).toHaveBeenCalledTimes(1)
    expect(adapter.write).not.toHaveBeenCalled()
    expect(value('demo-ch-1')).toBe(0.92) // 1.02 closes 20% of the gap to fresh 0.5.
    expect(value(channel.id)).toBe(0.5)
  })
  it('converges once per click, excludes the golden target, groups Undo and clears a removed target', async () => {
    const w = store.getSnapshot().workspace
    const ids = w.channels.slice(0, 3).map((c) => c.id)
    store.setConvergeTarget(ids[0])
    const before = ids.map((id) => value(id))
    await store.converge(
      [...ids, ids[1]],
      'large',
      Object.fromEntries(ids.map((id) => [id, ['gain']])),
    )
    await settle()
    expect(value(ids[0])).toBe(before[0])
    expect(value(ids[1])).toBeCloseTo(0.99)
    expect(store.getSnapshot().history).toHaveLength(1)
    expect(store.getSnapshot().history[0].label).toBe('Converge large')
    store.undo()
    await settle()
    expect(ids.map((id) => value(id))).toEqual(before)
    store.removeDevice(w.channels[0].deviceId)
    expect(store.getSnapshot().workspace.convergeTargetId).toBeUndefined()
  })
  it('preflights all Converge members and allows a locked reference without writing it', async () => {
    const ids = ['demo-ch-1', 'demo-ch-2', 'demo-ch-3']
    store.updateChannel(ids[2], { locked: true })
    await store.converge(ids, 'large')
    expect(store.getSnapshot().busy).toBe(0)
    expect(store.getSnapshot().history).toHaveLength(0)
    store.setConvergeTarget(ids[2])
    await store.converge(ids, 'large')
    await settle()
    expect(store.getSnapshot().history[0].changes.every((c) => c.channelId !== ids[2])).toBe(true)
  })
  it('uses fresh target readbacks and cancels a conflicting write without overwriting hardware', async () => {
    const { channel, adapter } = hardwareFixture()
    store.setConvergeTarget('demo-ch-1')
    vi.mocked(adapter.read).mockResolvedValueOnce({
      values: { ...channel.values, gain: 0.5 },
      context: channel.context,
    })
    vi.mocked(adapter.read).mockResolvedValue({
      values: { ...channel.values, gain: 0.6 },
      context: channel.context,
    })
    await store.converge([channel.id, 'demo-ch-1'], 'large', { [channel.id]: ['gain'] })
    await settle()
    expect(adapter.write).not.toHaveBeenCalled()
    expect(store.getSnapshot().activities.some((a) => a.text.includes('Converge conflict'))).toBe(
      true,
    )
  })
  it('does not dispatch Converge after a failed read or duplicate click while reading', async () => {
    const { channel, adapter } = hardwareFixture()
    store.setConvergeTarget('demo-ch-1')
    let rejectRead!: (reason: Error) => void
    vi.mocked(adapter.read).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject
        }),
    )
    const first = store.converge([channel.id, 'demo-ch-1'], 'large')
    expect(store.getSnapshot().converging).toBe(true)
    await store.converge([channel.id, 'demo-ch-1'], 'large')
    rejectRead(new Error('No target readback'))
    await first
    expect(adapter.write).not.toHaveBeenCalled()
    expect(store.getSnapshot().converging).toBe(false)
    expect(store.getSnapshot().busy).toBe(0)
  })
  it('announces demo edits and adjustments without announcing live writes or background refresh', async () => {
    const notice = vi.fn(),
      unsubscribe = subscribeDemoChanges(notice)
    try {
      await store.refresh()
      expect(notice).not.toHaveBeenCalled()
      store.updateChannel('demo-ch-1', { label: 'Wide demo' })
      expect(notice).toHaveBeenCalledWith(['FS1'])
      notice.mockClear()
      store.adjust(['demo-ch-1'], 'gain', 0.1, 'relative')
      expect(notice).toHaveBeenCalledWith(['FS1'])
      await settle()
      const { channel } = hardwareFixture()
      notice.mockClear()
      store.adjust([channel.id], 'gain', 0.1, 'relative')
      await settle()
      expect(notice).not.toHaveBeenCalled()
      store.adjust([channel.id, 'demo-ch-1'], 'gain', 0.1, 'relative')
      expect(notice).toHaveBeenCalledWith(['FS1'])
      await settle()
    } finally {
      unsubscribe()
    }
  })
  it('announces bypassed members on mixed adjustments without excluding their stored values', async () => {
    const off = store.getSnapshot().workspace.channels[0]
    const on = store.getSnapshot().workspace.channels[1]
    store.adjust([off.id], 'procEnabled', 0, 'absolute')
    await settle()
    const notice = vi.fn(),
      unsubscribe = subscribeStageAdjustments(notice)
    try {
      store.adjust([off.id, on.id], 'gain', 0.1, 'relative')
      expect(notice).toHaveBeenCalledWith({
        stage: 'procEnabled',
        bypassedIds: [off.id],
        kind: 'mixed',
      })
      await settle()
      expect(value(off.id)).toBeCloseTo(off.values.gain! + 0.1)
      expect(value(on.id)).toBeCloseTo(on.values.gain! + 0.1)
      expect(
        store.getSnapshot().workspace.channels.find((c) => c.id === off.id)?.values.procEnabled,
      ).toBe(0)
      notice.mockClear()
      store.adjust([on.id], 'gain', 0.01, 'relative')
      expect(notice).not.toHaveBeenCalled()
      await settle()
      store.reset([off.id, on.id], 'Proc amp')
      expect(notice).toHaveBeenCalledWith({
        stage: 'procEnabled',
        bypassedIds: [off.id],
        kind: 'mixed',
      })
    } finally {
      unsubscribe()
    }
  })
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
    await store.addWorkspace(undefined, 'empty')
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
  it('keeps gang card membership independent across views and workspace exports', () => {
    const { gangs, channels } = store.getSnapshot().workspace
    const [gang, other] = gangs
    const custom = customViewKey('custom')
    const ownView = gangViewKey(gang.id)
    store.saveView({ id: 'custom', name: 'Custom', cards: [channels[0].id, other.id] })
    const cards = (view: string) => cardsInView(store.getSnapshot().workspace, view)

    expect(cards(ownView)[0]).toBe(gang.id)
    store.showGangCard(gang.id, true, custom)
    store.showGangCard(other.id, false, custom)
    store.showGangCard(gang.id, false, ownView)
    store.showGangCard(other.id, true)
    expect(cards(custom)).toEqual([channels[0].id, gang.id])
    expect(cards(ownView)).not.toContain(gang.id)
    expect(cards('all')).toContain(other.id)
    expect(cards('all')).not.toContain(gang.id)
    expect(cards('favorites')).not.toContain(other.id)

    const restored = validateWorkspace(JSON.parse(JSON.stringify(store.getSnapshot().workspace)))
    expect(cardsInView(restored, ownView)).toEqual(cards(ownView))
    expect(cardsInView(restored, custom)).toEqual(cards(custom))
    store.deleteGang(gang.id)
    expect(cards(custom)).toEqual([channels[0].id])
    expect(store.getSnapshot().workspace.gangCardVisibility?.[ownView]).toBeUndefined()
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
  it('drops rapid inputs and groups accepted samples from one slider gesture into one undo entry', async () => {
    for (let i = 0; i < 10; i++)
      store.adjust(['demo-ch-1'], 'gain', 0.01, 'relative', 'one-gesture')
    expect(store.getSnapshot().busy).toBe(1)
    await settle()
    expect(value('demo-ch-1')).toBe(1.03)
    expect(store.adjust(['demo-ch-1'], 'gain', 0.01, 'relative', 'one-gesture')).toBe(true)
    await settle()
    expect(value('demo-ch-1')).toBe(1.04)
    expect(store.getSnapshot().history).toHaveLength(1)
    store.undo()
    await settle()
    expect(value('demo-ch-1')).toBe(1.02)
  })
  it('lets one accepted gang nudge finish without appending more clicks', async () => {
    const members = ['demo-ch-1', 'demo-ch-2', 'demo-ch-5']
    expect(store.adjust(members, 'gain', 0.01, 'relative')).toBe(true)
    for (let i = 0; i < 12; i++) expect(store.adjust(members, 'gain', 0.01, 'relative')).toBe(false)
    await settle()
    expect(members.map((id) => value(id))).toEqual([1.03, 0.99, 1.01])
    expect(store.getSnapshot().busy).toBe(0)
    expect(store.getSnapshot().history).toHaveLength(1)
  })
  it('never defers an input until a hardware poll finishes', async () => {
    const { channel, adapter } = hardwareFixture()
    let complete!: () => void
    vi.mocked(adapter.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () => resolve({ values: channel.values, context: channel.context })
        }),
    )
    const polling = store.refresh()
    expect(store.adjust([channel.id], 'gain', 0.01, 'relative')).toBe(false)
    complete()
    await polling
    await settle()
    expect(adapter.write).not.toHaveBeenCalled()
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
    await store.addWorkspace(w, 'import')
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
  it('locks hardware after an uncertain write and ignores concurrent input', async () => {
    const { channel, adapter } = hardwareFixture()
    vi.mocked(adapter.write).mockRejectedValue(new Error('Network failed after send'))
    store.adjust([channel.id], 'gain', 1.1, 'absolute')
    expect(store.adjust([channel.id], 'black', 1, 'absolute')).toBe(false)
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
    await store.addWorkspace(w, 'import')
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
