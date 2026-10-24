import { expect, it } from 'vitest'
import { demoWorkspace } from './demo'
import { planConvergence } from './converge'

function fixture(values: number[], parameter: 'gain' | 'hue' = 'gain') {
  return demoWorkspace()
    .channels.slice(0, values.length)
    .map((c, i) => ({
      ...c,
      descriptors: c.descriptors.filter((d) => d.id === parameter || d.id === 'procEnabled'),
      values: { [parameter]: values[i], procEnabled: 1 },
    }))
}
it('uses a robust median and scales small/large steps without overshooting', () => {
  const channels = fixture([0.9, 1, 1, 1.1, 1.5])
  const small = planConvergence(channels, 'small')
  const large = planConvergence(channels, 'large')
  expect(small.changes.find((c) => c.channelId === channels[4].id)?.after).toBe(1.48)
  expect(large.changes.find((c) => c.channelId === channels[4].id)?.after).toBe(1.4)
  expect(large.changes.find((c) => c.channelId === channels[0].id)?.after).toBe(0.92)
  expect(large.changes.some((c) => c.channelId === channels[1].id)).toBe(false)
  for (const c of large.changes) expect(c.after).toBeGreaterThanOrEqual(Math.min(c.before, 1))
})
it('uses a golden target outside or inside the selection without writing it', () => {
  const channels = fixture([0.5, 1, 1.5]),
    reference = channels[1]
  for (const selection of [channels, [channels[0], channels[2]]]) {
    const plan = planConvergence(selection, 'large', reference)
    expect(plan.changes.map((c) => c.after)).toEqual([0.6, 1.4])
    expect(plan.changes.some((c) => c.channelId === reference.id)).toBe(false)
  }
})
it('carries sub-step fractions across clicks and resets carry after manual edits', () => {
  const channels = fixture([1, 1.01]),
    reference = channels[1]
  let plan = planConvergence(channels, 'small', reference)
  expect(plan.changes).toHaveLength(0)
  for (let i = 0; i < 11 && !plan.changes.length; i++)
    plan = planConvergence(channels, 'small', reference, {}, plan.remainders)
  expect(plan.changes[0].after).toBe(1.01)
  channels[0].values.gain = 1.02
  const edited = planConvergence(channels, 'small', reference, {}, plan.remainders)
  expect(edited.changes).toHaveLength(0)
  expect(edited.remainders.get(`${channels[0].id}:gain`)?.amount).toBeCloseTo(-0.0005)
})
it('respects masks, native limits and all-Off stages while allowing mixed stored-value changes', () => {
  const channels = fixture([0.5, 1, 1.5]),
    reference = channels[1]
  const masks = { [channels[2].id]: ['hue' as const] }
  expect(
    planConvergence(channels, 'large', reference, masks).changes.map((c) => c.channelId),
  ).toEqual([channels[0].id])
  channels[0].values.procEnabled = 0
  expect(planConvergence(channels, 'large', reference, masks).changes).toHaveLength(0)
  expect(planConvergence(channels, 'large', reference).changes.map((c) => c.after)).toEqual([
    0.6, 1.4,
  ])
  channels[2].descriptors.find((d) => d.id === 'gain')!.max = 0.8
  channels[2].values.gain = 0.8
  expect(planConvergence(channels, 'large', reference).changes.every((c) => c.after <= 1)).toBe(
    true,
  )
})
it('skips unknown or incompatible target controls rather than falling back silently', () => {
  const channels = fixture([0.5, 1, 1.5]),
    reference = channels[1]
  reference.descriptors.find((d) => d.id === 'gain')!.unit = 'different'
  expect(planConvergence(channels, 'large', reference).skipped).toEqual(['gain'])
  expect(planConvergence(channels, 'large', reference).changes).toHaveLength(0)
})
it('moves hue across the short wrap path and handles bounded hue ranges linearly', () => {
  const channels = fixture([179, -179], 'hue')
  let plan = planConvergence(channels, 'large')
  for (let i = 0; i < 4 && !plan.changes.length; i++)
    plan = planConvergence(channels, 'large', undefined, {}, plan.remainders)
  expect(plan.changes.map((c) => c.after)).toEqual([180, 180])
  channels.forEach((c) => {
    const d = c.descriptors.find((d) => d.id === 'hue')!
    d.min = -20
    d.max = 20
  })
  channels[0].values.hue = -10
  channels[1].values.hue = 10
  expect(planConvergence(channels, 'large').changes.map((c) => c.after)).toEqual([-8, 8])
})
it('keeps the circular median robust when far hue outliers straddle the largest gap', () => {
  const channels = fixture([0, 10, 20, 170, 175], 'hue')
  const changes = planConvergence(channels, 'large').changes
  expect(changes.find((c) => c.channelId === channels[0].id)?.after).toBe(4)
  expect(changes.some((c) => c.channelId === channels[2].id)).toBe(false)
})
