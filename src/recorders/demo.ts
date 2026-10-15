import {
  durationText,
  type RecorderAdapter,
  type RecorderConfig,
  type RecorderSnapshot,
} from './types'

export function demoRecorder(model: RecorderConfig['model'] = 'HELO'): RecorderConfig {
  return {
    id: crypto.randomUUID(),
    label: `${model} demo`,
    address: '',
    model,
    simulated: true,
    warningMinutes: 15,
  }
}
export class DemoRecorderAdapter implements RecorderAdapter {
  constructor(private model: RecorderConfig['model'] = 'HELO') {}
  private started?: number
  private closed = false
  async read(): Promise<RecorderSnapshot> {
    if (this.closed) throw new Error('Connection closed')
    const elapsed = this.started === undefined ? 0 : (Date.now() - this.started) / 1000
    const helo = this.model.startsWith('HELO')
    const go = this.model.startsWith('Ki Pro GO')
    const primary = helo ? 'SD · Primary' : go ? 'USB 1 · Primary' : 'Slot 1 · Primary'
    return {
      state: this.started === undefined ? 'idle' : 'recording',
      updatedAt: Date.now(),
      enabled: false,
      duration: durationText(elapsed),
      recordingId: this.started === undefined ? undefined : String(this.started),
      durationKind: 'clip',
      canControl: true,
      firmware: 'Simulation',
      scope: 'Simulated recorder',
      warnings: [],
      media: [
        {
          id: 'primary',
          label: primary,
          status: this.started === undefined ? 'Ready' : 'Recording',
          active: true,
          freeBytes: Math.max(0, 128e9 - elapsed * 2e6),
          totalBytes: 256e9,
          remainingSeconds: Math.max(0, 64000 - elapsed),
          updatedAt: Date.now(),
          metrics: [],
          warnings: [],
        },
        {
          id: 'usb',
          label: helo ? 'USB' : go ? 'USB 2' : 'Slot 2',
          status: 'Ready',
          active: false,
          freeBytes: 256e9,
          totalBytes: 512e9,
          updatedAt: Date.now(),
          metrics: [],
          warnings: [],
        },
        ...(helo
          ? [
              {
                id: 'network',
                label: 'Network',
                status: 'Not configured',
                active: false,
                updatedAt: Date.now(),
                metrics: [],
                warnings: [],
              },
            ]
          : go
            ? [3, 4, 5].map((n) => ({
                id: `usb-${n}`,
                label: `USB ${n}`,
                status: 'Not present',
                active: false,
                updatedAt: Date.now(),
                metrics: [],
                warnings: [],
              }))
            : []),
      ],
    }
  }
  async command(action: 'record' | 'stop') {
    if (this.closed) throw new Error('Connection closed')
    if (action === 'record') this.started ??= Date.now()
    else this.started = undefined
  }
  dispose() {
    this.closed = true
  }
}
