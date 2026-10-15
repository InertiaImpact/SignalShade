export const recorderModels = [
  'HELO',
  'HELO Plus',
  'Ki Pro',
  'Ki Pro Mini',
  'Ki Pro Rack',
  'Ki Pro Ultra',
  'Ki Pro Ultra Plus',
  'Ki Pro Ultra 12G',
  'Ki Pro GO',
  'Ki Pro GO2',
] as const
export type RecorderModel = (typeof recorderModels)[number]
export interface RecorderConfig {
  id: string
  label: string
  address: string
  model: RecorderModel
  simulated: boolean
  warningMinutes: number
}
export type TransportState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'starting'
  | 'finalizing'
  | 'error'
  | 'unknown'
  | 'offline'
  | 'playback'
export interface MediaMetric {
  label: string
  value: string
}
export interface RecorderMedia {
  id: string
  label: string
  status: string
  active: boolean
  freeBytes?: number
  totalBytes?: number
  freePercent?: number
  remainingSeconds?: number
  updatedAt: number
  metrics: MediaMetric[]
  warnings: string[]
}
export interface RecorderSnapshot {
  state: TransportState
  updatedAt: number
  duration?: string
  durationKind?: 'clip' | 'observed'
  recordingId?: string
  media: RecorderMedia[]
  warnings: string[]
  firmware?: string
  scope: string
  canControl: boolean
  controlReason?: string
  pending?: 'record' | 'stop'
  enabled: boolean
  issue?: string
}
export interface RecorderAdapter {
  read(includeMedia: boolean): Promise<RecorderSnapshot>
  command(action: 'record' | 'stop'): Promise<void>
  dispose(): void
}
export const disconnected = (): RecorderSnapshot => ({
  state: 'offline',
  updatedAt: 0,
  media: [],
  warnings: [],
  scope: 'Device',
  canControl: false,
  enabled: false,
})
export function durationText(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds))
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':')
}
export function recorderWarnings(
  snapshot: RecorderSnapshot,
  config: RecorderConfig,
  now = Date.now(),
): string[] {
  return [
    ...new Set([
      ...snapshot.warnings,
      ...(snapshot.issue ? [snapshot.issue] : []),
      ...(snapshot.updatedAt && now - snapshot.updatedAt > 10000 ? ['Status stale'] : []),
      ...snapshot.media.flatMap((m) => [
        ...m.warnings.map((w) => `${m.label}: ${w}`),
        ...(m.updatedAt && now - m.updatedAt > 15000 ? [`${m.label}: media stale`] : []),
        ...(m.remainingSeconds !== undefined && m.remainingSeconds <= config.warningMinutes * 60
          ? [`${m.label}: ${m.remainingSeconds <= 300 ? 'critical' : 'low'} time remaining`]
          : []),
      ]),
    ]),
  ]
}
