import { message } from '../adapters/aja'
import { AjaRecorderAdapter } from './aja'
import { DemoRecorderAdapter } from './demo'
import {
  disconnected,
  durationText,
  type RecorderAdapter,
  type RecorderConfig,
  type RecorderSnapshot,
} from './types'

interface Connection {
  adapter: RecorderAdapter
  busy: boolean
  failures: number
  nextPoll: number
  mediaAt: number
  reading?: Promise<void>
  observedStart?: number
  controlRequested: boolean
}
export class RecorderStore {
  private state: Record<string, RecorderSnapshot> = {}
  private configs: RecorderConfig[] = []
  private listeners = new Set<() => void>()
  private connections = new Map<string, Connection>()
  constructor(
    private allowed: () => boolean,
    private log: (text: string, type?: 'success' | 'error' | 'info') => void,
    private rememberConnection: (id: string) => void = () => {},
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.state
  get pending() {
    return Object.values(this.state).some((s) => s.pending)
  }
  private patch(id: string, patch: Partial<RecorderSnapshot>) {
    this.state = { ...this.state, [id]: { ...(this.state[id] ?? disconnected()), ...patch } }
    this.listeners.forEach((l) => l())
  }
  sync(configs: RecorderConfig[]) {
    this.configs = configs
    for (const [id, connection] of this.connections)
      if (!configs.some((c) => c.id === id)) {
        connection.adapter.dispose()
        this.connections.delete(id)
      }
    this.state = Object.fromEntries(configs.map((c) => [c.id, this.state[c.id] ?? disconnected()]))
    // Previously connected recorders resume read-only monitoring; polls never request permissions.
    for (const config of configs)
      if (
        (config.simulated || config.autoConnect) &&
        !this.connections.has(config.id) &&
        this.allowed()
      ) {
        this.attach(
          config.id,
          config.simulated ? new DemoRecorderAdapter(config.model) : new AjaRecorderAdapter(config),
        )
        void this.refresh(config.id)
      }
    this.listeners.forEach((l) => l())
  }
  attach(id: string, adapter: RecorderAdapter) {
    if (!this.allowed()) {
      adapter.dispose()
      throw new Error('Desk is locked')
    }
    if (this.state[id]?.pending) {
      adapter.dispose()
      throw new Error('Wait for the recorder command')
    }
    this.connections.get(id)?.adapter.dispose()
    this.connections.set(id, {
      adapter,
      busy: false,
      failures: 0,
      nextPoll: 0,
      mediaAt: 0,
      controlRequested: this.controlPreference(id),
    })
    this.patch(id, { ...disconnected(), state: 'unknown' })
  }
  async connect(config: RecorderConfig, password = '') {
    this.attach(
      config.id,
      config.simulated
        ? new DemoRecorderAdapter(config.model)
        : new AjaRecorderAdapter(config, password),
    )
    await this.refresh(config.id)
    if (this.state[config.id]?.updatedAt && this.state[config.id].state !== 'offline')
      this.rememberConnection(config.id)
  }
  disconnect(id: string) {
    if (this.state[id]?.pending) return
    this.connections.get(id)?.adapter.dispose()
    this.connections.delete(id)
    this.patch(id, { ...disconnected() })
  }
  private preferenceKey(id: string) {
    const config = this.configs.find((c) => c.id === id)
    return `signalshade-recorder-control:${id}:${config?.address}:${config?.model}`
  }
  private controlPreference(id: string) {
    try {
      return sessionStorage.getItem(this.preferenceKey(id)) === 'true'
    } catch {
      return false
    }
  }
  private rememberControl(id: string, enabled: boolean) {
    const c = this.connections.get(id)
    if (c) c.controlRequested = enabled
    try {
      sessionStorage.setItem(this.preferenceKey(id), String(enabled))
    } catch {
      /* Storage may be unavailable. */
    }
  }
  enable(id: string, enabled: boolean) {
    if (!this.allowed()) return
    const s = this.state[id]
    if (
      !s ||
      (enabled &&
        (!s.canControl ||
          !s.updatedAt ||
          Date.now() - s.updatedAt > 10000 ||
          s.state === 'offline'))
    )
      return
    this.rememberControl(id, enabled)
    this.patch(id, { enabled })
  }
  private current(id: string, connection: Connection) {
    return this.connections.get(id) === connection
  }
  private accept(id: string, c: Connection, next: RecorderSnapshot) {
    if (!this.current(id, c)) return
    const before = this.state[id]
    let recordingId = before?.recordingId
    if (
      next.state === 'recording' &&
      (before?.state !== 'recording' ||
        (next.recordingId && next.recordingId !== before.recordingId))
    ) {
      recordingId = next.recordingId ?? crypto.randomUUID()
      c.observedStart =
        before?.state === 'idle' && Date.now() - before.updatedAt < 10000 ? Date.now() : undefined
    } else if (next.state !== 'recording') {
      recordingId = undefined
      c.observedStart = undefined
    }
    if (!next.duration && next.state === 'recording' && c.observedStart !== undefined) {
      next.duration = durationText((Date.now() - c.observedStart) / 1000)
      next.durationKind = 'observed'
    }
    this.patch(id, {
      ...next,
      recordingId,
      enabled:
        c.controlRequested &&
        next.canControl &&
        !['offline', 'unknown', 'error'].includes(next.state),
      pending: before?.pending,
      issue: undefined,
    })
  }
  refresh(id: string): Promise<void> {
    const c = this.connections.get(id)
    if (!c || c.busy) return c?.reading ?? Promise.resolve()
    c.busy = true
    c.reading = this.poll(id, c).finally(() => {
      c.reading = undefined
    })
    return c.reading
  }
  private async poll(id: string, c: Connection) {
    try {
      const media = Date.now() - c.mediaAt >= 5000 || !c.mediaAt
      const next = await c.adapter.read(media)
      this.accept(id, c, next)
      c.failures = 0
      if (media) c.mediaAt = Date.now()
      c.nextPoll = Date.now() + (next.state === 'recording' ? 1000 : 2000)
    } catch (e) {
      if (this.current(id, c))
        this.patch(id, { state: 'offline', enabled: false, issue: message(e) })
      c.observedStart = undefined
      c.nextPoll = Date.now() + Math.min(30000, 2000 * 2 ** ++c.failures)
    } finally {
      c.busy = false
    }
  }
  async tick() {
    // At most two appliances poll concurrently. Each connection coalesces ticks and commands.
    const slots = Math.max(0, 2 - [...this.connections.values()].filter((c) => c.busy).length)
    const due = [...this.connections]
      .filter(([, c]) => !c.busy && c.nextPoll <= Date.now())
      .sort((a, b) => a[1].nextPoll - b[1].nextPoll)
      .slice(0, slots)
    await Promise.all(due.map(([id]) => this.refresh(id)))
  }
  async command(id: string, action: 'record' | 'stop', recordingId?: string) {
    const c = this.connections.get(id)
    if (!c || !this.allowed() || !this.state[id]?.enabled || this.state[id].pending) return
    const config = this.configs.find((v) => v.id === id)
    if (!config) return
    this.patch(id, { pending: action, issue: undefined })
    await c.reading
    if (!this.current(id, c)) return
    c.busy = true
    let attempted = false
    try {
      const before = await c.adapter.read(true)
      this.accept(id, c, before)
      if (!this.current(id, c) || !this.allowed() || !this.state[id].enabled || !before.canControl)
        throw new Error('Recorder controls are locked')
      if (action === 'stop' && recordingId && recordingId !== this.state[id].recordingId)
        throw new Error('Recording changed; confirm Stop again')
      if (
        (action === 'record' && before.state === 'recording') ||
        (action === 'stop' && before.state === 'idle')
      )
        return
      if (
        action === 'record'
          ? before.state !== 'idle'
          : !['recording', 'paused'].includes(before.state)
      )
        throw new Error('Recorder is not ready for this command')
      attempted = true
      await c.adapter.command(action)
      let confirmed = false
      let pausedStopSent = false
      for (let i = 0; i < 8; i++) {
        if (!this.current(id, c)) return
        if (i) await new Promise((r) => setTimeout(r, 500))
        const next = await c.adapter.read(false)
        this.accept(id, c, next)
        if (next.state === (action === 'record' ? 'recording' : 'idle')) {
          confirmed = true
          break
        }
        // Ki Pro documentation: a first Stop may pause. Only send a second after fresh PAUSED readback.
        if (
          action === 'stop' &&
          next.state === 'paused' &&
          !pausedStopSent &&
          config.model.startsWith('Ki Pro') &&
          this.allowed() &&
          this.state[id].enabled
        ) {
          pausedStopSent = true
          await c.adapter.command('stop')
        }
      }
      if (!confirmed) throw new Error('Command not confirmed — verify recorder')
      this.log(
        `${config.label}: ${action === 'record' ? 'recording confirmed' : 'stopped'}`,
        'success',
      )
    } catch (e) {
      if (!this.current(id, c)) return
      // Never resend after an ambiguous write. Reconcile through reads, and require re-enabling control.
      if (attempted) {
        try {
          this.accept(id, c, await c.adapter.read(true))
        } catch {
          this.patch(id, { state: 'unknown' })
        }
      }
      this.patch(id, { enabled: false, issue: message(e) })
      this.rememberControl(id, false)
      this.log(`${config.label}: ${message(e)}`, 'error')
    } finally {
      c.busy = false
      c.nextPoll = 0
      if (this.current(id, c)) this.patch(id, { pending: undefined })
    }
  }
  dispose() {
    this.connections.forEach((c) => c.adapter.dispose())
    this.connections.clear()
    this.state = {}
    this.listeners.forEach((l) => l())
  }
}
