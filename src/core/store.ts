import { AjaAdapter, message } from '../adapters/aja'
import { commonValue, isCompatible, quantize } from './color'
import { demoWorkspace, emptyWorkspace } from './demo'
import { loadWorkspace, saveWorkspace, validateWorkspace } from './persistence'
import type {
  Activity,
  Change,
  Channel,
  ColorPreset,
  DeviceAdapter,
  Gang,
  ParameterId,
  ProbeResult,
  UndoEntry,
  Workspace,
} from './types'

interface Snapshot {
  workspace: Workspace
  activities: Activity[]
  history: UndoEntry[]
  busy: number
  lockedTab: boolean
  ready: boolean
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
export class DeskStore {
  private state: Snapshot = {
    workspace: demoWorkspace(),
    activities: [],
    history: [],
    busy: 0,
    lockedTab: false,
    ready: false,
  }
  private listeners = new Set<() => void>()
  private adapters = new Map<string, DeviceAdapter>()
  private queues = new Map<string, Job[]>()
  private running = new Set<string>()
  private historyIds = new Map<string, UndoEntry>()
  private saveTimer?: ReturnType<typeof setTimeout>
  private releaseLock?: () => void
  private generation = 0
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
  private workspace(workspace: Workspace) {
    this.emit({ workspace })
    clearTimeout(this.saveTimer)
    if (this.state.ready && !this.state.lockedTab)
      this.saveTimer = setTimeout(() => {
        saveWorkspace(this.state.workspace).catch((e) =>
          this.emit({ storageError: `Local save failed: ${message(e)}. Export a backup.` }),
        )
      }, 500)
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
      if (saved) this.emit({ workspace: this.sanitize(saved) })
    } catch (e) {
      this.emit({
        storageError: `Could not restore local workspace: ${message(e)}. Export a backup before closing.`,
      })
    }
    this.emit({ ready: true })
    this.log('Desk ready. Demo devices never send network commands.')
  }
  dispose() {
    this.adapters.forEach((a) => a.dispose())
    this.releaseLock?.()
    clearTimeout(this.saveTimer)
  }
  private sanitize(workspace: Workspace): Workspace {
    return {
      ...workspace,
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
    if (!this.state.ready || this.state.lockedTab) {
      this.log(
        'This tab is read-only. Close the other SignalShade control tab and reload.',
        'error',
      )
      return false
    }
    return true
  }
  private available(channel: Channel) {
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
  updateChannel(id: string, patch: Partial<Pick<Channel, 'label' | 'locked'>>) {
    if (this.canEdit())
      this.workspace({
        ...this.state.workspace,
        channels: this.state.workspace.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      })
  }
  reorderChannel(id: string, direction: -1 | 1) {
    if (!this.canEdit()) return
    const channels = [...this.state.workspace.channels],
      index = channels.findIndex((c) => c.id === id),
      target = index + direction
    if (index < 0 || target < 0 || target >= channels.length) return
    ;[channels[index], channels[target]] = [channels[target], channels[index]]
    this.workspace({ ...this.state.workspace, channels })
  }
  saveGang(gang: Gang) {
    if (!this.canEdit()) return
    if (!gang.name.trim() || !gang.members.length)
      throw new Error('Give the gang a name and at least one channel')
    const groups = this.state.workspace.gangs.filter((g) => g.id !== gang.id)
    this.workspace({
      ...this.state.workspace,
      gangs: [...groups, { ...gang, name: gang.name.trim(), members: [...new Set(gang.members)] }],
    })
    this.log(`Saved gang “${gang.name}”`)
  }
  deleteGang(id: string) {
    if (this.canEdit())
      this.workspace({
        ...this.state.workspace,
        gangs: this.state.workspace.gangs.filter((g) => g.id !== id),
      })
  }
  async replaceWorkspace(input: unknown, kind: 'import' | 'demo' | 'empty') {
    if (!this.canEdit()) return
    if (this.state.busy) throw new Error('Wait for pending commands before changing workspaces')
    const next = this.sanitize(
      validateWorkspace(
        kind === 'demo' ? demoWorkspace() : kind === 'empty' ? emptyWorkspace() : input,
      ),
    )
    this.generation++
    this.adapters.forEach((a) => a.dispose())
    this.adapters.clear()
    this.historyIds.clear()
    this.emit({ history: [] })
    this.workspace(next)
    this.log('Workspace loaded. Hardware writes are locked until reconnected.')
  }
  connect(adapter: AjaAdapter, result: ProbeResult, label: string) {
    if (!this.canEdit()) return
    if (!result.model || !result.channels.length || result.checks.some((c) => c.status === 'fail'))
      throw new Error('Resolve failed connection checks before adding this device')
    if (this.state.busy)
      throw new Error('Wait for pending commands before replacing a device connection')
    const workspace = this.state.workspace
    const old = workspace.devices.find((d) => d.id === result.address)
    const others = workspace.channels.filter((c) => c.deviceId !== result.address)
    if (others.length + result.channels.length > 32)
      throw new Error(
        'This workspace supports up to 32 channels. Remove demo devices or start an empty workspace first.',
      )
    this.adapters.get(result.address)?.dispose()
    this.adapters.set(result.address, adapter)
    const channels = result.channels.map((c) => ({
      ...c,
      label: workspace.channels.find((oldChannel) => oldChannel.id === c.id)?.label ?? c.label,
    }))
    const ids = new Set([...others, ...channels].map((c) => c.id))
    this.workspace({
      ...workspace,
      devices: [
        ...workspace.devices.filter((d) => d.id !== result.address),
        {
          id: result.address,
          label:
            label.trim() || old?.label || `${result.model} · ${new URL(result.address).hostname}`,
          model: result.model,
          firmware: result.firmware ?? 'Unknown',
          address: result.address,
          simulated: false,
          status: 'online',
          armed: false,
        },
      ],
      channels: [...others, ...channels],
      gangs: workspace.gangs.map((g) => ({ ...g, members: g.members.filter((id) => ids.has(id)) })),
    })
    this.log(`Connected ${label || result.model} in read-only mode`, 'success')
  }
  armDevice(id: string, armed: boolean) {
    if (!this.canEdit()) return
    const device = this.state.workspace.devices.find((d) => d.id === id)
    if (!device?.simulated && armed && (!this.adapters.has(id) || device?.status !== 'online'))
      throw new Error('Reconnect and pass the device checks first')
    this.workspace({
      ...this.state.workspace,
      devices: this.state.workspace.devices.map((d) => (d.id === id ? { ...d, armed } : d)),
    })
    this.log(`${device?.label}: live writes ${armed ? 'enabled' : 'locked'}`)
  }
  removeDevice(id: string) {
    if (!this.canEdit()) return
    if (this.state.busy) throw new Error('Wait for pending commands before removing a device')
    this.adapters.get(id)?.dispose()
    this.adapters.delete(id)
    const channels = this.state.workspace.channels.filter((c) => c.deviceId !== id),
      ids = new Set(channels.map((c) => c.id))
    this.workspace({
      ...this.state.workspace,
      devices: this.state.workspace.devices.filter((d) => d.id !== id),
      channels,
      gangs: this.state.workspace.gangs.map((g) => ({
        ...g,
        members: g.members.filter((id) => ids.has(id)),
      })),
    })
  }
  adjust(
    ids: string[],
    parameter: ParameterId,
    value: number,
    mode: 'relative' | 'absolute',
    gestureId?: string,
  ) {
    if (!this.canEdit()) return
    const channels = [...new Set(ids)]
      .map((id) => this.state.workspace.channels.find((c) => c.id === id))
      .filter((c): c is Channel => !!c)
    if (!Number.isFinite(value) || !channels.length || !isCompatible(channels, parameter)) {
      this.log('This parameter is not compatible across all selected channels', 'error')
      return
    }
    const operationId = gestureId ?? crypto.randomUUID()
    for (const channel of channels)
      this.enqueue({
        channelId: channel.id,
        parameter,
        value,
        mode,
        operationId,
        label: `${mode === 'relative' ? 'Trim' : 'Set'} ${channel.descriptors.find((d) => d.id === parameter)!.label}`,
        context: channel.context,
      })
  }
  reset(ids: string[], section?: string, includeEnables = false) {
    if (!this.canEdit()) return
    const operationId = crypto.randomUUID()
    for (const id of new Set(ids)) {
      const channel = this.state.workspace.channels.find((c) => c.id === id)
      if (!channel) continue
      for (const d of channel.descriptors)
        if (
          (!section || d.section === section) &&
          (includeEnables || !['procEnabled', 'rgbEnabled'].includes(d.id))
        )
          this.enqueue({
            channelId: id,
            parameter: d.id,
            value: d.neutral,
            mode: 'absolute',
            operationId,
            label: 'Reset color',
            context: channel.context,
          })
    }
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
              this.patchChannel(channel.id, { ...state, updatedAt: Date.now() })
              throw new Error('Source changed; adjustment cancelled')
            }
            before = state.values[job.parameter]
            this.patchChannel(channel.id, { ...state, updatedAt: Date.now() })
          }
          if (before === undefined) throw new Error('No current value available')
          if (job.expected !== undefined && before !== job.expected)
            throw new Error('Undo conflict: value changed since this operation')
          const next = quantize(job.mode === 'relative' ? before + job.value : job.value, d)
          const limited =
            job.mode === 'relative' && Math.abs(next - (before + job.value)) > d.step / 2
          const current = this.state.workspace.channels.find((c) => c.id === channel.id)!
          this.available(current)
          const after = device.simulated
            ? await new Promise<number>((r) => setTimeout(() => r(next), 25))
            : await adapter!.write(current, d, next)
          this.patchChannel(channel.id, {
            values: {
              ...this.state.workspace.channels.find((c) => c.id === channel.id)!.values,
              [job.parameter]: after,
            },
            updatedAt: Date.now(),
            issue: undefined,
          })
          if (before !== after && job.expected === undefined)
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
          if (channel && !this.state.workspace.devices.find((d) => d.id === deviceId)?.simulated) {
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
                        'Write failed or unverified. Reconnect; queued changes were discarded.',
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
    const operationId = crypto.randomUUID()
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
      if (
        this.state.workspace.devices.find((d) => d.id === target.deviceId)?.model !== source.model
      )
        throw new Error(
          'Cross-model preset recall is not qualified. Choose a matching device model.',
        )
      for (const [parameter, value] of Object.entries(source.values)) {
        const original = source.descriptors.find((d) => d.id === parameter)
        if (!original) throw new Error(`Preset metadata missing for ${parameter}`)
        if (!enabledSections.includes(original.section)) continue
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
    operations.forEach((o) => this.enqueue(o))
  }
  async refresh() {
    if (this.state.lockedTab) return
    for (const device of this.state.workspace.devices) {
      if (
        device.simulated ||
        !this.adapters.has(device.id) ||
        this.running.has(device.id) ||
        device.status !== 'online'
      )
        continue
      this.running.add(device.id)
      try {
        for (const channel of this.state.workspace.channels.filter(
          (c) => c.deviceId === device.id,
        )) {
          const state = await this.adapters.get(device.id)!.read(channel)
          if (state.context !== channel.context)
            this.log(`${channel.label}: source context changed; values refreshed`)
          this.patchChannel(channel.id, { ...state, updatedAt: Date.now(), issue: undefined })
        }
      } catch (e) {
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
        this.running.delete(device.id)
        if (this.queues.get(device.id)?.length) void this.drain(device.id)
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
