import { expect, it } from 'vitest'
import { demoWorkspace } from './demo'
import { demoRecorder } from '../recorders/demo'
import { changedDemoLabels } from './demo-feedback'

it('identifies simulated settings changes while ignoring polling bookkeeping and live devices', () => {
  const before = demoWorkspace(),
    next = structuredClone(before)
  next.channels[0].updatedAt++
  next.channels[0].pending = true
  next.devices[0].status = 'connecting'
  expect(changedDemoLabels(before, next)).toEqual([])
  next.channels[0].values.gain = 1.4
  next.channels[1].label = 'Wide'
  expect(changedDemoLabels(before, next)).toEqual(['FS1'])
  before.devices[0].simulated = next.devices[0].simulated = false
  expect(changedDemoLabels(before, next)).toEqual([])
})
it('detects demo additions, removals and recorder configuration changes', () => {
  const before = demoWorkspace(),
    next = structuredClone(before)
  const recorder = demoRecorder('HELO Plus')
  next.recorders = [recorder]
  expect(changedDemoLabels(before, next)).toEqual([recorder.label])
  before.recorders = [recorder]
  next.recorders[0] = { ...recorder, label: 'Program demo' }
  expect(changedDemoLabels(before, next)).toEqual(['Program demo'])
  next.devices.pop()
  expect(changedDemoLabels(before, next)).toEqual(['FS3', 'Program demo'])
})
