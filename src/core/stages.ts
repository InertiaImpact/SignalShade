import type { Channel, ParameterDescriptor } from './types'

export type StageId = 'procEnabled' | 'rgbEnabled'
export function correctionStage(d: ParameterDescriptor): StageId | undefined {
  if (d.id === 'procEnabled' || d.id === 'rgbEnabled') return
  if (d.section === 'Proc amp') return 'procEnabled'
  if (d.section === 'RGB correction') return 'rgbEnabled'
}
export function stageIsOff(channels: Channel[], d: ParameterDescriptor) {
  const stage = correctionStage(d)
  // Missing optional enable metadata is not evidence of bypass.
  return !!stage && channels.length > 0 && channels.every((c) => c.values[stage] === 0)
}
type StageAdjustment = { stage: StageId; bypassedIds: string[]; kind: 'mixed' | 'enable-needed' }
const listeners = new Set<(notice: StageAdjustment) => void>()
export function subscribeStageAdjustments(listener: (notice: StageAdjustment) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function notifyStageAdjustment(channels: Channel[], stage: StageId) {
  const bypassedIds = channels.filter((c) => c.values[stage] === 0).map((c) => c.id)
  if (bypassedIds.length && channels.some((c) => c.values[stage] === 1))
    listeners.forEach((listener) => listener({ stage, bypassedIds, kind: 'mixed' }))
}
export function requestStageEnable(channels: Channel[], d: ParameterDescriptor) {
  const stage = correctionStage(d)
  if (stage && stageIsOff(channels, d))
    listeners.forEach((listener) =>
      listener({ stage, bypassedIds: channels.map((c) => c.id), kind: 'enable-needed' }),
    )
}
