import type { RecorderConfig } from '../recorders/types'
export type Section = 'Proc amp' | 'RGB correction' | 'Legalizer'
export type ParameterId =
  | 'gain'
  | 'black'
  | 'hue'
  | 'saturation'
  | 'procEnabled'
  | 'redGain'
  | 'greenGain'
  | 'blueGain'
  | 'redBlack'
  | 'greenBlack'
  | 'blueBlack'
  | 'redGamma'
  | 'greenGamma'
  | 'blueGamma'
  | 'rgbEnabled'
  | `legalizer.${string}`
export type Values = Partial<Record<ParameterId, number>>
export type Model = 'FS4' | 'FS2' | 'FS1-X' | 'FS1' | 'FS-HDR'
export interface ParameterDescriptor {
  id: ParameterId
  label: string
  section: Section
  min: number
  max: number
  step: number
  neutral: number
  unit: string
  precision: number
  kind: 'number' | 'toggle' | 'enum'
  nativeId?: string
  scale?: number
  offset?: number
  choices?: { value: number; label: string }[]
}
export interface Channel {
  id: string
  deviceId: string
  processor: number
  label: string
  source: string
  format: string
  context: string
  values: Values
  descriptors: ParameterDescriptor[]
  updatedAt: number
  locked: boolean
  pending: boolean
  issue?: string
}
export interface Device {
  id: string
  label: string
  model: Model
  firmware: string
  address: string
  simulated: boolean
  status: 'online' | 'offline' | 'connecting'
  armed: boolean
  issue?: string
}
export interface Gang {
  id: string
  name: string
  color: string
  members: string[]
  parameters: ParameterId[]
  showAsCard?: boolean
}
export interface ColorPreset {
  id: string
  name: string
  createdAt: number
  channels: {
    channelId: string
    label: string
    model: Model
    values: Values
    descriptors: ParameterDescriptor[]
  }[]
}
export interface Workspace {
  recorders?: RecorderConfig[]
  version: 1
  name: string
  devices: Device[]
  channels: Channel[]
  gangs: Gang[]
  presets: ColorPreset[]
  favorites: ParameterId[]
  density: 'comfortable' | 'compact'
  hiddenSections: Section[]
}
export interface Activity {
  id: string
  at: number
  text: string
  type: 'success' | 'error' | 'info'
}
export interface Change {
  channelId: string
  parameter: ParameterId
  before: number
  after: number
  context: string
}
export interface UndoEntry {
  label: string
  changes: Change[]
}
export interface DeviceAdapter {
  read(
    channel: Channel,
  ): Promise<{ values: Values; context: string; source?: string; format?: string }>
  write(channel: Channel, descriptor: ParameterDescriptor, value: number): Promise<number>
  dispose(): void
}
export interface ProbeResult {
  legacyReadbacks?: { id: string; response?: unknown; error?: string }[]
  webIdentity?: { title?: string; model?: string; status?: number }
  address: string
  model?: Model
  firmware?: string
  descriptors: ParameterDescriptor[]
  channels: Channel[]
  checks: { name: string; status: 'pass' | 'fail' | 'info'; detail: string }[]
  rawDescriptorCount: number
  rawDescriptors?: Record<string, unknown>[]
}
