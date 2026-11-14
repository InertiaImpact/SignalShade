import { AjaAdapter, message } from '../adapters/aja'
import { commonValue, isCompatible, quantize } from './color'
import { demoWorkspace, emptyWorkspace, demoDevice } from './demo'
import {
  loadWorkspace,
  originalWorkspaceId,
  saveWorkspace,
  validateWorkspace,
  type WorkspaceLibrary,
} from './persistence'
import { cardsInView, customViewKey, pruneViewCards } from './views'
import { RecorderStore } from '../recorders/store'
import type { RecorderConfig } from '../recorders/types'
import { isVisibleControl } from './layout'
import { correctionStage, notifyStageAdjustment, type StageId } from './stages'
import { changedDemoLabels, notifyDemoChange } from './demo-feedback'
import { planConvergence, type ConvergeStep, type ConvergeRemainder } from './converge'
import type {
  Activity,
  Change,
  Channel,
  ColorPreset,
  Device,
  DeskView,
  DeviceAdapter,
  Gang,
  ParameterId,
  ProbeResult,
  UndoEntry,
  Workspace,
  Model,
  ParameterMasks,
} from './types'

interface Snapshot {
  workspace: Workspace
  workspaceId: string
  workspaces: { id: string; name: string }[]
  activities: Activity[]
  history: UndoEntry[]
  busy: number
  lockedTab: boolean
  ready: boolean
  controlsLocked: boolean
  converging: boolean
  storageError?: string
}
interface Job {
  channelId: string
  parameter: ParameterId
  value: number
  mode: 'relative' | 'absolute'
  operationId: string
  label: string
  expected?: number
  context: string
}
const deskLockKey = 'signalshade-desk-locked'
const processorControlKey = (device: Device, workspaceId: string) =>
  `signalshade-processor-control:${workspaceId === originalWorkspaceId ? '' : workspaceId + ':'}${device.id}:${device.address}`
function sessionPreference(key: string, value?: string | null) {
  try {
    if (value === undefined) return sessionStorage.getItem(key)
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // A tab without session storage can still connect and arm manually.
  }
}
function processorControlSignature(model: Model, firmware: string, channels: Channel[]) {
  return JSON.stringify([
    model,
    firmware,
    [...channels]
      .sort((a, b) => a.processor - b.processor)
      .map((channel) => [
        channel.processor,
        [...channel.descriptors]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((d) => [
            d.id,
            d.nativeId,
            d.kind,
            d.unit,
            d.min,
            d.max,
            d.step,
            d.neutral,
            d.scale,
            d.offset,
            d.choices?.map((choice) => choice.value),
          ]),
      ]),
  ])
}
export class DeskStore {
  private state: Snapshot = {
    workspace: demoWorkspace(),
    workspaceId: originalWorkspaceId,
    workspaces: [{ id: originalWorkspaceId, name: demoWorkspace().name }],
    activities: [],
    history: [],
    busy: 0,
    lockedTab: false,
    ready: false,
    controlsLocked: false,
    converging: false,
  }
  private listeners = new Set<() => void>()
  private inactiveWorkspaces = new Map<string, Workspace>()
  private adapters = new Map<string, DeviceAdapter>()
  private restoring = new Map<string, AbortController>()
  private queues = new Map<string, Job[]>()
  private running = new Set<string>()
  private historyIds = new Map<string, UndoEntry>()
  private saveTimer?: ReturnType<typeof setTimeout>
  private releaseLock?: () => void
  private generation = 0
  private convergeRemainders = new Map<string, ConvergeRemainder>()
  readonly recorders = new RecorderStore(
    () => this.state.ready && !this.state.lockedTab && !this.state.controlsLocked,
    (text, type) => this.log(text, type),
    (id) => {
      const configs = this.state.workspace.recorders ?? []
      if (!configs.find((c) => c.id === id)?.autoConnect)
        this.saveRecorders(configs.map((c) => (c.id === id ? { ...c, autoConnect: true } : c)))
    },
    () => (this.state.workspaceId === originalWorkspaceId ? '' : this.state.workspaceId),
  )
  setControlsLocked(controlsLocked: boolean) {
    sessionPreference(deskLockKey, controlsLocked ? 'true' : null)
    this.emit({ controlsLocked })
    if (!controlsLocked && this.state.ready && !this.state.lockedTab)
      this.recorders.sync(this.state.workspace.recorders ?? [])
  }
  private rememberProcessorControl(device: Device, armed: boolean) {
    if (device.simulated) return
    const channels = this.state.workspace.channels.filter((c) => c.deviceId === device.id)
    sessionPreference(
      processorControlKey(device, this.state.workspaceId),
      armed ? processorControlSignature(device.model, device.firmware, channels) : null,
    )
  }
  saveRecorders(recorders: RecorderConfig[]) {
    if (!this.canEdit()) return
    if (this.recorders.pending) throw new Error('Wait for the recorder command')
    const next = validateWorkspace({ ...this.state.workspace, recorders })
    this.workspace(next)
    this.recorders.sync(next.recorders ?? [])
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private emit(patch: Partial<Snapshot> = {}) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }
  private workspace(workspace: Workspace, workspaceId = this.state.workspaceId) {
    if (
      workspace.convergeTargetId &&
      !workspace.channels.some((c) => c.id === workspace.convergeTargetId)
    )
      workspace = { ...workspace, convergeTargetId: undefined }
    const demoChanges = this.state.ready ? changedDemoLabels(this.state.workspace, workspace) : []
    const workspaces = [...this.inactiveWorkspaces.entries(), [workspaceId, workspace] as const]
      .map(([id, saved]) => ({ id, name: saved.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
    this.emit({ workspace, workspaceId, workspaces })
    notifyDemoChange(demoChanges)
    clearTimeout(this.saveTimer)
    if (this.state.ready && !this.state.lockedTab)
      this.saveTimer = setTimeout(() => {
        void this.persistWorkspaces()
      }, 500)
  }
  private async persistWorkspaces() {
    const library: WorkspaceLibrary = {
      active: this.state.workspaceId,
      entries: [
        ...[...this.inactiveWorkspaces].map(([id, workspace]) => ({ id, workspace })),
        { id: this.state.workspaceId, workspace: this.state.workspace },
      ],
    }
    try {
      await saveWorkspace(library)
    } catch (e) {
      this.emit({ storageError: `Local save failed: ${message(e)}. Export a backup.` })
    }
  }
  log(text: string, type: Activity['type'] = 'info') {
    this.emit({
      activities: [
        { id: crypto.randomUUID(), at: Date.now(), text, type },
        ...this.state.activities,
      ].slice(0, 150),
    })
  }
  async initialize() {
    if (this.state.ready) return
    if (navigator.locks) {
      let decided!: () => void
      const acquired = new Promise<void>((r) => {
        decided = r
      })
      void navigator.locks.request('signalshade-control', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          this.emit({ lockedTab: true })
          decided()
          return
        }
        decided()
        await new Promise<void>((r) => {
          this.releaseLock = r
        })
      })
      await acquired
    } else this.emit({ lockedTab: true })
    try {
      const saved = await loadWorkspace()
      if (saved) {
        const active = saved.entries.find((entry) => entry.id === saved.active)!
        this.inactiveWorkspaces = new Map(
          saved.entries
            .filter((entry) => entry !== active)
            .map(({ id, workspace }) => [id, workspace]),
        )
        this.workspace(this.sanitize(active.workspace), active.id)
      }
    } catch (e) {
      this.emit({
        storageError: `Could not restore local workspace: ${message(e)}. Export a backup before closing.`,
      })
    }
    this.emit({ ready: true, controlsLocked: sessionPreference(deskLockKey) === 'true' })
    if (!this.state.lockedTab) this.recorders.sync(this.state.workspace.recorders ?? [])
    this.log('Desk ready. Demo devices never send network commands.')
    if (!this.state.lockedTab) await this.restoreProcessors()
  }
  dispose() {
    this.generation++
    this.restoring.forEach((controller) => controller.abort())
    this.recorders.dispose()
    this.adapters.forEach((a) => a.dispose())
    this.releaseLock?.()
    clearTimeout(this.saveTimer)
  }
  private sanitize(workspace: Workspace): Workspace {
    return {
      ...workspace,
      recorders: workspace.recorders?.map((c) => ({
        ...c,
        autoConnect: c.autoConnect ?? !c.simulated,
      })),
      devices: workspace.devices.map((d) => ({
        ...d,
        status: d.simulated ? 'online' : 'offline',
        armed: d.simulated,
        issue: undefined,
      })),
      channels: workspace.channels.map((c) => ({
        ...c,
        pending: false,
        updatedAt: workspace.devices.find((d) => d.id === c.deviceId)?.simulated ? Date.now() : 0,
        issue: undefined,
      })),
    }
  }
  private canEdit() {
    if (this.state.converging) {
      this.log('Wait for the Converge step to finish.', 'info')
      return false
    }
    if (!this.state.ready || this.state.lockedTab || this.state.controlsLocked) {
      this.log(
        this.state.controlsLocked
          ? 'Desk controls are locked.'
          : 'This tab is read-only. Close the other SignalShade control tab and reload.',
        'error',
      )
      return false
    }
    return true
  }
  private available(channel: Channel) {
    if (this.state.controlsLocked || this.state.lockedTab || !this.state.ready)
      throw new Error('Desk controls are locked')
    const device = this.state.workspace.devices.find((d) => d.id === channel.deviceId)
    if (!device || device.status !== 'online' || !device.armed || channel.locked)
      throw new Error(
        `${channel.label}: ${channel.locked ? 'channel is locked' : !device?.armed ? 'live writes are not enabled' : 'device is offline'}`,
      )
    if (
      !device.simulated &&
      (!this.adapters.has(device.id) ||
        !channel.updatedAt ||
        Date.now() - channel.updatedAt > 15000)
    )
      throw new Error(`${channel.label}: state is stale; refresh the device`)
    return device
  }
  updateWorkspace(
    patch: Partial<Pick<Workspace, 'name' | 'favorites' | 'density' | 'hiddenSections'>>,
  ) {
    if (this.canEdit()) this.workspace({ ...this.state.workspace, ...patch })
  }
  setConvergeTarget(id?: string) {
    if (!this.canEdit()) return
    if (this.state.busy) {
      this.log('Wait for pending adjustments before changing the Converge target.', 'info')
      return
    }
    if (id && !this.state.workspace.channels.some((c) => c.id === id)) return
    this.convergeRemainders.clear()
    this.workspace({ ...this.state.workspace, convergeTargetId: id })
  }
  async converge(ids: string[], step: ConvergeStep, masks: ParameterMasks = {}) {
    if (!this.canEdit() || this.state.busy) return
    const { workspace } = this.state
    const channels = workspace.channels.filter((c) => ids.includes(c.id))
    if (channels.length < 2 || !['small', 'large'].includes(step)) return
    const reference = workspace.channels.find((c) => c.id === workspace.convergeTargetId)
    const moving = channels.filter((c) => c.id !== reference?.id)
    const reads = [...moving, ...(reference ? [reference] : [])]
    const devices = [...new Set(reads.map((c) => c.deviceId))]
    const acquired: string[] = []
    const generation = this.generation
    try {
      // Validate every writable member before reading or dispatching any step.
      moving.forEach((c) => {
        this.available(c)
        if (c.issue || c.pending) throw new Error(`${c.label}: refresh before Converge`)
      })
      for (const id of devices) {
        if (this.running.has(id))
          throw new Error('A device is refreshing; try Converge again shortly')
        const device = workspace.devices.find((d) => d.id === id)
        if (device?.status !== 'online' || (!device.simulated && !this.adapters.has(id)))
          throw new Error('Reconnect the Converge target and selected devices first')
      }
      this.emit({ converging: true })
      for (const id of devices) {
        this.running.add(id)
        acquired.push(id)
      }
      const readResults = await Promise.allSettled(
        devices.map(async (id) => {
          if (workspace.devices.find((d) => d.id === id)?.simulated) return
          const adapter = this.adapters.get(id)!
          for (const channel of reads.filter((c) => c.deviceId === id)) {
            const readback = await adapter.read(channel)
            if (generation !== this.generation)
              throw new Error('Workspace changed; Converge cancelled')
            if (readback.context !== channel.context)
              throw new Error('Source changed; refresh before Converge')
            this.patchChannel(channel.id, { ...readback, updatedAt: Date.now(), issue: undefined })
          }
        }),
      )
      const failed = readResults.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      if (generation !== this.generation || this.state.controlsLocked) return
      const current = this.state.workspace.channels
      const plan = planConvergence(
        current.filter((c) => ids.includes(c.id)),
        step,
        current.find((c) => c.id === reference?.id),
        masks,
        this.convergeRemainders,
      )
      this.convergeRemainders = plan.remainders
      const operationId = crypto.randomUUID()
      this.announceAdjustments(plan.intents)
      plan.changes.forEach((change) =>
        this.enqueue({
          channelId: change.channelId,
          parameter: change.parameter,
          value: change.after,
          mode: 'absolute',
          expected: change.before,
          operationId,
          label: `Converge ${step}`,
          context: change.context,
        }),
      )
      if (plan.skipped.length)
        this.log(
          `Converge skipped unsupported or incompatible controls: ${plan.skipped.join(', ')}`,
          'info',
        )
      if (!plan.changes.length)
        this.log(
          plan.remainders.size
            ? 'Converge: no native step yet; small fractions carry to the next click.'
            : 'Converge: values are aligned within device precision or no enabled compatible controls are available.',
          'info',
        )
    } catch (e) {
      this.convergeRemainders.clear()
      this.log(`Converge: ${message(e)}. No new step dispatched.`, 'error')
    } finally {
      acquired.forEach((id) => this.running.delete(id))
      this.emit({ converging: false })
      acquired.forEach((id) => {
        if (this.queues.get(id)?.length) void this.drain(id)
      })
    }
  }
  updateChannel(id: string, patch: Partial<Pick<Channel, 'label' | 'locked'>>) {
    if (this.canEdit())
      this.workspace({
        ...this.state.workspace,
        channels: this.state.workspace.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      })
  }
  addDemoDevice(model: Model, label = '') {
    if (!this.canEdit()) return
    const demo = demoDevice(model, label, this.state.workspace)
    if (this.state.workspace.channels.length + demo.channels.length > 32)
      throw new Error('This workspace supports up to 32 processors')
    this.workspace({
      ...this.state.workspace,
      devices: [...this.state.workspace.devices, demo.device],
      channels: [...this.state.workspace.channels, ...demo.channels],
    })
    return demo.device.id
  }
  renameDevice(id: string, label: string) {
    if (this.canEdit() && label.trim())
      this.workspace({
        ...this.state.workspace,
        devices: this.state.workspace.devices.map((d) =>
          d.id === id ? { ...d, label: label.trim() } : d,
        ),
      })
  }
  saveView(view: DeskView) {
    if (!this.canEdit()) return
    const workspace = this.state.workspace
    const views = workspace.views ?? []
    const next = { ...view, name: view.name.trim() }
    if (!next.name || !next.cards.length)
      throw new Error('Name the view and choose at least one card')
    this.workspace(
      validateWorkspace({
        ...workspace,
        views: views.some((item) => item.id === view.id)
          ? views.map((item) => (item.id === view.id ? next : item))
          : [...views, next],
      }),
    )
  }
  deleteView(id: string) {
    if (!this.canEdit()) return
    const workspace = this.state.workspace
    this.workspace({ ...workspace, views: workspace.views?.filter((view) => view.id !== id) })
  }
  moveViewCard(view: string, id: string, target: string) {
    if (id === target || !this.canEdit()) return
    const workspace = this.state.workspace
    const cards = cardsInView(workspace, view)
    const sourceIndex = cards.indexOf(id)
    const targetIndex = cards.indexOf(target)
    if (sourceIndex < 0 || targetIndex < 0) return
    cards.splice(sourceIndex, 1)
    cards.splice(targetIndex, 0, id)
    const custom = workspace.views?.find((item) => customViewKey(item.id) === view)
    if (custom)
      this.workspace({
        ...workspace,
        views: workspace.views?.map((item) => (item.id === custom.id ? { ...item, cards } : item)),
      })
    else this.workspace({ ...workspace, cardOrders: { ...workspace.cardOrders, [view]: cards } })
  }
  saveGang(gang: Gang) {
    if (!this.canEdit()) return
    if (!gang.name.trim() || !gang.members.length)
      throw new Error('Give the gang a name and at least one channel')
    const saved = { ...gang, name: gang.name.trim(), members: [...new Set(gang.members)] }
    const groups = this.state.workspace.gangs
    this.workspace({
      ...this.state.workspace,
      gangs: groups.some((g) => g.id === gang.id)
        ? groups.map((g) => (g.id === gang.id ? saved : g))
        : [...groups, saved],
    })
    this.log(`Saved gang “${gang.name}”`)
  }
  deleteGang(id: string) {
    if (this.canEdit()) {
      const next = {
        ...this.state.workspace,
        gangs: this.state.workspace.gangs.filter((g) => g.id !== id),
      }
      this.workspace({ ...next, ...pruneViewCards(next) })
    }
  }
  showGangCard(id: string, showAsCard: boolean, view = 'all') {
    if (!this.canEdit()) return
    const workspace = this.state.workspace
    if (!workspace.gangs.some((g) => g.id === id)) return
    if (view === 'all') {
      this.workspace({
        ...workspace,
        gangs: workspace.gangs.map((g) => (g.id === id ? { ...g, showAsCard } : g)),
      })
      return
    }
    const custom = workspace.views?.find((item) => customViewKey(item.id) === view)
    if (custom) {
      const cards = showAsCard
        ? [...new Set([...custom.cards, id])]
        : custom.cards.filter((card) => card !== id)
      this.workspace({
        ...workspace,
        views: workspace.views?.map((item) => (item.id === custom.id ? { ...item, cards } : item)),
      })
      return
    }
    this.workspace({
      ...workspace,
      gangCardVisibility: {
        ...workspace.gangCardVisibility,
        [view]: { ...workspace.gangCardVisibility?.[view], [id]: showAsCard },
      },
    })
  }
  private requireWorkspaceChange() {
    if (!this.canEdit()) throw new Error('Unlock the desk before changing workspaces')
    if (this.state.busy || this.recorders.pending)
      throw new Error('Wait for pending commands before changing workspaces')
  }
  async addWorkspace(input: unknown, kind: 'import' | 'demo' | 'empty', name?: string) {
    this.requireWorkspaceChange()
    const workspace = validateWorkspace(
      kind === 'demo' ? demoWorkspace() : kind === 'empty' ? emptyWorkspace() : input,
    )
    const id = crypto.randomUUID()
    await this.activateWorkspace(
      id,
      name?.trim() ? { ...workspace, name: name.trim().slice(0, 100) } : workspace,
      false,
    )
  }
  async switchWorkspace(id: string) {
    if (id === this.state.workspaceId) return
    this.requireWorkspaceChange()
    const workspace = this.inactiveWorkspaces.get(id)
    if (workspace) await this.activateWorkspace(id, workspace, true)
  }
  private async activateWorkspace(id: string, workspace: Workspace, reconnect: boolean) {
    const next = this.sanitize(workspace)
    this.convergeRemainders.clear()
    this.inactiveWorkspaces.set(this.state.workspaceId, this.state.workspace)
    this.inactiveWorkspaces.delete(id)
    this.generation++
    this.restoring.forEach((controller) => controller.abort())
    this.restoring.clear()
    this.recorders.dispose()
    this.adapters.forEach((a) => a.dispose())
    this.adapters.clear()
    this.running.clear()
    this.queues.clear()
    this.historyIds.clear()
    this.emit({ history: [], activities: [] })
    this.workspace(next, id)
    this.recorders.sync(next.recorders ?? [], reconnect)
    clearTimeout(this.saveTimer)
    void this.persistWorkspaces()
    if (reconnect) void this.restoreProcessors()
  }
  connect(adapter: AjaAdapter, result: ProbeResult, label: string) {
    if (!this.canEdit()) return
    if (this.state.busy)
      throw new Error('Wait for pending commands before replacing a device connection')
    const saved = this.state.workspace.devices.find(
      (device) => !device.simulated && device.address === result.address,
    )
    this.installProcessor(adapter, result, label, saved)
    if (saved) this.rememberProcessorControl(saved, false)
  }
  private installProcessor(
    adapter: AjaAdapter,
    result: ProbeResult,
    label: string,
    saved?: Device,
    restoreControl = false,
  ) {
    if (!result.model || !result.channels.length || result.checks.some((c) => c.status === 'fail'))
      throw new Error(
        result.checks.find((check) => check.status === 'fail')?.detail ??
          'Resolve failed connection checks before adding this device',
      )
    const workspace = this.state.workspace
    const id = saved?.id ?? result.address
    let deviceNumber = 1
    while (workspace.devices.some((d) => d.id !== id && d.label === `FS${deviceNumber}`))
      deviceNumber++
    const deviceLabel = label.trim() || saved?.label || `FS${deviceNumber}`
    const others = workspace.channels.filter((c) => c.deviceId !== id)
    if (others.length + result.channels.length > 32)
      throw new Error(
        'This workspace supports up to 32 channels. Remove demo devices or start an empty workspace first.',
      )
    this.restoring.get(id)?.abort()
    this.adapters.get(id)?.dispose()
    this.adapters.set(id, adapter)
    const prior = new Map(workspace.channels.map((c) => [c.id, c]))
    const channels = new Map(
      result.channels.map((channel) => {
        const old = prior.get(channel.id)
        const c = {
          ...channel,
          deviceId: id,
          locked: old?.locked ?? false,
          label: old?.label ?? `${deviceLabel} - Input ${channel.processor}`,
        }
        return [c.id, c]
      }),
    )
    const ordered = workspace.channels.flatMap((c) => {
      if (c.deviceId !== id) return [c]
      const updated = channels.get(c.id)
      channels.delete(c.id)
      return updated ? [updated] : []
    })
    ordered.push(...channels.values())
    const ids = new Set(ordered.map((c) => c.id))
    const firmware = result.firmware ?? 'Unknown'
    const armed =
      restoreControl &&
      !!saved &&
      result.channels.some((c) => c.descriptors.length > 0) &&
      result.channels.every(
        (c) => !!c.updatedAt && Date.now() - c.updatedAt <= 15000 && !c.issue,
      ) &&
      sessionPreference(processorControlKey(saved, this.state.workspaceId)) ===
        processorControlSignature(result.model, firmware, result.channels)
    const device: Device = {
      id,
      label: deviceLabel,
      model: result.model,
      firmware,
      address: result.address,
      simulated: false,
      status: 'online',
      armed,
    }
    const next = {
      ...workspace,
      devices: saved
        ? workspace.devices.map((d) => (d.id === id ? device : d))
        : [...workspace.devices, device],
      channels: ordered,
      gangs: workspace.gangs.map((g) => ({ ...g, members: g.members.filter((id) => ids.has(id)) })),
    }
    this.workspace({ ...next, ...pruneViewCards(next) })
    if (restoreControl && !armed) this.rememberProcessorControl(device, false)
    this.log(
      armed
        ? `Reconnected ${deviceLabel} with writes enabled`
        : `Connected ${deviceLabel} in read-only mode`,
      'success',
    )
  }
  private async restoreProcessors() {
    const devices = this.state.workspace.devices.filter((device) => !device.simulated)
    if (!devices.length) return
    const generation = this.generation
    this.emit({
      workspace: {
        ...this.state.workspace,
        devices: this.state.workspace.devices.map((device) =>
          device.simulated ? device : { ...device, status: 'connecting' },
        ),
      },
    })
    const restore = async () => {
      while (devices.length && generation === this.generation) {
        const saved = devices.shift()!
        if (
          !this.state.workspace.devices.some((d) => d.id === saved.id && d.status === 'connecting')
        )
          continue
        const controller = new AbortController()
        this.restoring.set(saved.id, controller)
        const timer = setTimeout(() => controller.abort(), 75_000)
        let adapter: AjaAdapter | undefined
        try {
          adapter = new AjaAdapter(saved.address)
          const result = await adapter.probe(controller.signal, saved.model)
          controller.signal.throwIfAborted()
          const current = this.state.workspace.devices.find((d) => d.id === saved.id)
          if (generation === this.generation && current?.status === 'connecting') {
            this.restoring.delete(saved.id)
            this.installProcessor(adapter, result, '', current, true)
            adapter = undefined
          }
        } catch (e) {
          if (generation !== this.generation) return
          const current = this.state.workspace.devices.find((d) => d.id === saved.id)
          if (current?.status !== 'connecting') continue
          this.rememberProcessorControl(current, false)
          const issue = controller.signal.aborted ? 'Reconnect timed out' : message(e)
          this.emit({
            workspace: {
              ...this.state.workspace,
              devices: this.state.workspace.devices.map((d) =>
                d.id === saved.id ? { ...d, status: 'offline', issue } : d,
              ),
            },
          })
          this.log(`${current.label}: ${issue}`, 'error')
        } finally {
          if (this.restoring.get(saved.id) === controller) this.restoring.delete(saved.id)
          clearTimeout(timer)
          adapter?.dispose()
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, devices.length) }, restore))
  }
  armDevice(id: string, armed: boolean) {
    if (!this.canEdit()) return
    const device = this.state.workspace.devices.find((d) => d.id === id)
    if (!device?.simulated && armed && (!this.adapters.has(id) || device?.status !== 'online'))
      throw new Error('Reconnect and pass the device checks first')
    if (
      armed &&
      !device?.simulated &&
      !this.state.workspace.channels.some(
        (channel) => channel.deviceId === id && channel.descriptors.length,
      )
    )
      throw new Error('No mapped color controls; this device is available for monitoring only')
    if (device && (!armed || !this.running.has(id))) this.rememberProcessorControl(device, armed)
    this.workspace({
      ...this.state.workspace,
      devices: this.state.workspace.devices.map((d) => (d.id === id ? { ...d, armed } : d)),
    })
    this.log(`${device?.label}: live writes ${armed ? 'enabled' : 'locked'}`)
  }
  removeDevice(id: string) {
    if (!this.canEdit()) return
    if (this.state.busy) throw new Error('Wait for pending commands before removing a device')
    const device = this.state.workspace.devices.find((d) => d.id === id)
    if (device) this.rememberProcessorControl(device, false)
    this.restoring.get(id)?.abort()
    this.adapters.get(id)?.dispose()
    this.adapters.delete(id)
    const channels = this.state.workspace.channels.filter((c) => c.deviceId !== id),
      ids = new Set(channels.map((c) => c.id))
    const next = {
      ...this.state.workspace,
      devices: this.state.workspace.devices.filter((d) => d.id !== id),
      channels,
      gangs: this.state.workspace.gangs.map((g) => ({
        ...g,
        members: g.members.filter((id) => ids.has(id)),
      })),
    }
    this.workspace({ ...next, ...pruneViewCards(next) })
  }
  adjust(
    ids: string[],
    parameter: ParameterId,
    value: number,
    mode: 'relative' | 'absolute',
    gestureId?: string,
  ): boolean {
    if (!this.canEdit()) return false
    const channels = [...new Set(ids)]
      .map((id) => this.state.workspace.channels.find((c) => c.id === id))
      .filter((c): c is Channel => !!c)
    if (!Number.isFinite(value) || !channels.length || !isCompatible(channels, parameter)) {
      this.log('This parameter is not compatible across all selected channels', 'error')
      return false
    }
    // An interactive input can start one batch, but never join work in progress.
    // A gang click still includes all its members, even on the same device.
    if (channels.some((c) => this.running.has(c.deviceId) || this.queues.get(c.deviceId)?.length))
      return false
    try {
      channels.forEach((channel) => this.available(channel))
    } catch (e) {
      this.log(message(e), 'error')
      return false
    }
    this.convergeRemainders.clear()
    const operationId = gestureId ?? crypto.randomUUID()
    const operations: Job[] = channels.map((channel) => ({
      channelId: channel.id,
      parameter,
      value,
      mode,
      operationId,
      label: `${mode === 'relative' ? 'Trim' : 'Set'} ${channel.descriptors.find((d) => d.id === parameter)!.label}`,
      context: channel.context,
    }))
    this.announceAdjustments(operations)
    operations.forEach((job) => this.enqueue(job))
    return true
  }
  reset(
    ids: string[],
    section?: string,
    includeEnables = false,
    mask?: ParameterId[],
    masks?: ParameterMasks,
  ) {
    if (!this.canEdit()) return
    this.convergeRemainders.clear()
    const operationId = crypto.randomUUID()
    const operations: Job[] = []
    for (const id of new Set(ids)) {
      const channel = this.state.workspace.channels.find((c) => c.id === id)
      if (!channel) continue
      for (const d of channel.descriptors)
        if (
          isVisibleControl(d) &&
          (!section || d.section === section) &&
          (!mask?.length || mask.includes(d.id)) &&
          (!masks?.[id]?.length || masks[id]!.includes(d.id)) &&
          (includeEnables || !['procEnabled', 'rgbEnabled'].includes(d.id))
        )
          operations.push({
            channelId: id,
            parameter: d.id,
            value: d.neutral,
            mode: 'absolute',
            operationId,
            label: 'Reset color',
            context: channel.context,
          })
    }
    this.announceAdjustments(operations)
    operations.forEach((job) => this.enqueue(job))
  }
  private announceAdjustments(operations: Pick<Job, 'channelId' | 'parameter'>[]) {
    const channelIds = new Set(operations.map((operation) => operation.channelId))
    const deviceIds = new Set(
      this.state.workspace.channels.filter((c) => channelIds.has(c.id)).map((c) => c.deviceId),
    )
    notifyDemoChange(
      this.state.workspace.devices
        .filter((d) => d.simulated && deviceIds.has(d.id))
        .map((d) => d.label),
    )
    const targets = new Map<StageId, Set<string>>()
    for (const operation of operations) {
      const channel = this.state.workspace.channels.find((c) => c.id === operation.channelId)
      const descriptor = channel?.descriptors.find((d) => d.id === operation.parameter)
      const stage = descriptor && correctionStage(descriptor)
      if (!stage) continue
      const ids = targets.get(stage) ?? new Set<string>()
      ids.add(operation.channelId)
      targets.set(stage, ids)
    }
    for (const [stage, ids] of targets)
      notifyStageAdjustment(
        this.state.workspace.channels.filter((c) => ids.has(c.id)),
        stage,
      )
  }
  private enqueue(job: Job) {
    const channel = this.state.workspace.channels.find((c) => c.id === job.channelId)
    if (!channel) return
    try {
      this.available(channel)
    } catch (e) {
      this.log(message(e), 'error')
      return
    }
    const queue = this.queues.get(channel.deviceId) ?? []
    const existing = queue.find(
      (j) =>
        j.channelId === job.channelId &&
        j.parameter === job.parameter &&
        j.mode === job.mode &&
        j.operationId === job.operationId,
    )
    if (existing) {
      existing.value = job.mode === 'relative' ? existing.value + job.value : job.value
    } else {
      queue.push(job)
      this.emit({ busy: this.state.busy + 1 })
    }
    this.queues.set(channel.deviceId, queue)
    this.patchChannel(channel.id, { pending: true })
    void this.drain(channel.deviceId)
  }
  private patchChannel(id: string, patch: Partial<Channel>) {
    this.workspace({
      ...this.state.workspace,
      channels: this.state.workspace.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })
  }
  private async drain(deviceId: string) {
    if (this.running.has(deviceId)) return
    this.running.add(deviceId)
    const queue = this.queues.get(deviceId)!
    const generation = this.generation
    try {
      while (queue.length && generation === this.generation) {
        const job = queue.shift()!
        const channel = this.state.workspace.channels.find((c) => c.id === job.channelId)
        try {
          if (!channel) throw new Error('Channel no longer exists')
          const device = this.available(channel),
            adapter = this.adapters.get(deviceId)
          if (channel.context !== job.context)
            throw new Error('Source context changed; adjustment cancelled')
          const d = channel.descriptors.find((p) => p.id === job.parameter)!
          let before = channel.values[job.parameter]
          if (!device.simulated && adapter) {
            const state = await adapter.read(channel)
            if (state.context !== job.context) {
              throw new Error('Source changed; adjustment cancelled')
            }
            before = state.values[job.parameter]
            this.patchChannel(channel.id, { ...state, updatedAt: Date.now() })
          }
          if (before === undefined) throw new Error('No current value available')
          if (job.expected !== undefined && before !== job.expected)
            throw new Error(
              `${job.label.startsWith('Converge') ? 'Converge' : 'Undo'} conflict: value changed since this operation`,
            )
          const next = quantize(job.mode === 'relative' ? before + job.value : job.value, d)
          const limited =
            job.mode === 'relative' && Math.abs(next - (before + job.value)) > d.step / 2
          const current = this.state.workspace.channels.find((c) => c.id === channel.id)!
          this.available(current)
          if (!device.simulated) this.rememberProcessorControl(device, false)
          const after = device.simulated
            ? await new Promise<number>((r) => setTimeout(() => r(next), 25))
            : await adapter!.write(current, d, next)
          const connected = this.state.workspace.devices.find((d) => d.id === deviceId)
          if (connected?.armed && !connected.simulated)
            this.rememberProcessorControl(connected, true)
          this.patchChannel(channel.id, {
            values: {
              ...this.state.workspace.channels.find((c) => c.id === channel.id)!.values,
              [job.parameter]: after,
            },
            updatedAt: Date.now(),
            issue: undefined,
          })
          if (before !== after && job.label !== 'Undo')
            this.recordHistory(job, {
              channelId: channel.id,
              parameter: job.parameter,
              before,
              after,
              context: job.context,
            })
          if (limited) this.log(`${channel.label} · ${d.label}: limited at ${after}`, 'info')
          else
            this.log(
              `${channel.label} · ${d.label} → ${after}${d.unit ? ` ${d.unit}` : ''}`,
              'success',
            )
        } catch (e) {
          const text = message(e)
          this.log(`${channel?.label ?? 'Channel'}: ${text}`, 'error')
          if (channel) this.patchChannel(channel.id, { issue: text })
          if (
            channel &&
            !/^(Source context changed; adjustment cancelled|Source changed; adjustment cancelled)$/.test(
              text,
            ) &&
            !this.state.workspace.devices.find((d) => d.id === deviceId)?.simulated
          ) {
            const failedDevice = this.state.workspace.devices.find((d) => d.id === deviceId)
            if (failedDevice) this.rememberProcessorControl(failedDevice, false)
            const dropped = queue.splice(0).length
            this.emit({ busy: this.state.busy - dropped })
            this.workspace({
              ...this.state.workspace,
              devices: this.state.workspace.devices.map((d) =>
                d.id === deviceId
                  ? {
                      ...d,
                      armed: false,
                      status: 'offline',
                      issue:
                        'Adjustment failed or readback did not match. Reconnect; queued changes were discarded.',
                    }
                  : d,
              ),
              channels: this.state.workspace.channels.map((c) =>
                c.deviceId === deviceId ? { ...c, pending: false, updatedAt: 0 } : c,
              ),
            })
          }
        } finally {
          this.emit({ busy: Math.max(0, this.state.busy - 1) })
          if (channel)
            this.patchChannel(channel.id, {
              pending: queue.some((j) => j.channelId === channel.id),
            })
        }
      }
    } finally {
      this.running.delete(deviceId)
    }
  }
  private recordHistory(job: Job, change: Change) {
    const entry = this.historyIds.get(job.operationId) ?? { label: job.label, changes: [] }
    const existing = entry.changes.find(
      (c) => c.channelId === change.channelId && c.parameter === change.parameter,
    )
    if (existing) existing.after = change.after
    else entry.changes.push(change)
    this.historyIds.set(job.operationId, entry)
    this.emit({ history: [entry, ...this.state.history.filter((e) => e !== entry)].slice(0, 50) })
    if (this.historyIds.size > 100)
      for (const [key, value] of this.historyIds)
        if (!this.state.history.includes(value)) this.historyIds.delete(key)
  }
  undo() {
    if (!this.canEdit() || this.state.busy) return
    const entry = this.state.history[0]
    if (!entry) return
    // Preflight every member; never knowingly perform a partial undo after a local conflict.
    for (const c of entry.changes) {
      const channel = this.state.workspace.channels.find((ch) => ch.id === c.channelId)
      if (!channel || channel.context !== c.context || channel.values[c.parameter] !== c.after) {
        this.log('Undo conflict: a target changed or was removed. No undo commands sent.', 'error')
        return
      }
      try {
        this.available(channel)
      } catch (e) {
        this.log(message(e), 'error')
        return
      }
    }
    this.emit({ history: this.state.history.slice(1) })
    this.convergeRemainders.clear()
    const operationId = crypto.randomUUID()
    this.announceAdjustments(entry.changes)
    for (const c of entry.changes)
      this.enqueue({
        channelId: c.channelId,
        parameter: c.parameter,
        value: c.before,
        mode: 'absolute',
        operationId,
        label: 'Undo',
        expected: c.after,
        context: c.context,
      })
  }
  savePreset(name: string, ids: string[]) {
    if (!this.canEdit()) return
    if (this.state.busy || !name.trim())
      throw new Error('Enter a name and wait for pending adjustments')
    const channels = this.state.workspace.channels.filter((c) => ids.includes(c.id))
    if (
      !channels.length ||
      channels.some(
        (c) =>
          !c.updatedAt ||
          !!c.issue ||
          this.state.workspace.devices.find((d) => d.id === c.deviceId)?.status !== 'online',
      )
    )
      throw new Error('Refresh all selected channels before saving a preset')
    const preset: ColorPreset = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: Date.now(),
      channels: channels.map((c) => ({
        channelId: c.id,
        label: c.label,
        model: this.state.workspace.devices.find((d) => d.id === c.deviceId)!.model,
        values: { ...c.values },
        descriptors: structuredClone(c.descriptors),
      })),
    }
    this.workspace({ ...this.state.workspace, presets: [...this.state.workspace.presets, preset] })
    this.log(`Saved preset “${preset.name}”`, 'success')
  }
  deletePreset(id: string) {
    if (this.canEdit())
      this.workspace({
        ...this.state.workspace,
        presets: this.state.workspace.presets.filter((p) => p.id !== id),
      })
  }
  recallPreset(preset: ColorPreset, mapping: Record<string, string>, enabledSections: string[]) {
    if (!this.canEdit()) return
    const operations: Job[] = [],
      used = new Set<string>(),
      operationId = crypto.randomUUID()
    for (const source of preset.channels) {
      const targetId = mapping[source.channelId]
      if (!targetId) continue
      if (used.has(targetId)) throw new Error('Map each preset source to a different target')
      used.add(targetId)
      const target = this.state.workspace.channels.find((c) => c.id === targetId)
      if (!target) throw new Error('Preset target no longer exists')
      this.available(target)
      for (const [parameter, value] of Object.entries(source.values)) {
        const original = source.descriptors.find((d) => d.id === parameter)
        if (!original) throw new Error(`Preset metadata missing for ${parameter}`)
        if (!isVisibleControl(original) || !enabledSections.includes(original.section)) continue
        const d = target.descriptors.find((d) => d.id === parameter)
        if (!d) throw new Error(`Unsupported parameter ${parameter} on ${target.label}`)
        if (
          d.unit !== original.unit ||
          d.kind !== original.kind ||
          d.scale !== original.scale ||
          d.offset !== original.offset ||
          JSON.stringify(d.choices) !== JSON.stringify(original.choices)
        )
          throw new Error(`Incompatible parameter semantics: ${d.label}`)
        if (value === undefined || value !== quantize(value, d))
          throw new Error(`${d.label} is outside the target range or resolution`)
        operations.push({
          channelId: target.id,
          parameter: d.id,
          value,
          mode: 'absolute',
          operationId,
          label: `Recall ${preset.name}`,
          context: target.context,
        })
      }
    }
    if (!operations.length) throw new Error('Select at least one mapped target and color section')
    this.convergeRemainders.clear()
    this.announceAdjustments(operations)
    operations.forEach((o) => this.enqueue(o))
  }
  async refresh() {
    if (this.state.lockedTab) return
    const generation = this.generation
    for (const device of this.state.workspace.devices) {
      if (generation !== this.generation) return
      if (
        device.simulated ||
        !this.adapters.has(device.id) ||
        this.running.has(device.id) ||
        device.status !== 'online'
      )
        continue
      this.running.add(device.id)
      const adapter = this.adapters.get(device.id)!
      try {
        for (const channel of this.state.workspace.channels.filter(
          (c) => c.deviceId === device.id,
        )) {
          const state = await adapter.read(channel)
          if (generation !== this.generation || this.adapters.get(device.id) !== adapter) return
          this.patchChannel(channel.id, { ...state, updatedAt: Date.now(), issue: undefined })
        }
      } catch (e) {
        if (generation !== this.generation || this.adapters.get(device.id) !== adapter) return
        this.rememberProcessorControl(device, false)
        this.workspace({
          ...this.state.workspace,
          devices: this.state.workspace.devices.map((d) =>
            d.id === device.id ? { ...d, status: 'offline', armed: false, issue: message(e) } : d,
          ),
          channels: this.state.workspace.channels.map((c) =>
            c.deviceId === device.id ? { ...c, updatedAt: 0, pending: false } : c,
          ),
        })
        const dropped = this.queues.get(device.id)?.splice(0).length ?? 0
        this.emit({ busy: Math.max(0, this.state.busy - dropped) })
        this.log(`${device.label}: ${message(e)}. Reconnect before adjusting.`, 'error')
      } finally {
        if (generation === this.generation) {
          this.running.delete(device.id)
          if (this.queues.get(device.id)?.length) void this.drain(device.id)
        }
      }
    }
  }
  selectedValue(ids: string[], parameter: ParameterId) {
    return commonValue(
      this.state.workspace.channels.filter((c) => ids.includes(c.id)),
      parameter,
    )
  }
}
export const desk = new DeskStore()
