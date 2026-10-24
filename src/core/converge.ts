import { isCompatible, quantize } from './color'
import { isVisibleControl } from './layout'
import { stageIsOff } from './stages'
import type { Channel, ParameterDescriptor, ParameterId, ParameterMasks } from './types'

export type ConvergeStep = 'small' | 'large'
export const convergeStrength = { small: 0.05, large: 0.2 } as const
export interface ConvergeRemainder {
  last: number
  amount: number
  signature: string
}
export interface ConvergeChange {
  channelId: string
  parameter: ParameterId
  before: number
  after: number
  context: string
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const angle = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180
const circular = (d: ParameterDescriptor) =>
  d.id === 'hue' && d.unit === '°' && d.max - d.min + d.step >= 360 - 1e-6
function circularMedian(values: number[]) {
  // Angular L1 minima occur at observations or on an interval between them.
  // Midpoints give even groups a centered target; squared distance breaks L1 ties.
  const candidates = [
    ...values,
    ...values.flatMap((a, i) => values.slice(i + 1).map((b) => a + angle(b - a) / 2)),
  ]
  return candidates
    .map((n) => {
      const target = angle(n),
        distances = values.map((value) => Math.abs(angle(target - value)))
      return {
        target,
        cost: distances.reduce((a, b) => a + b, 0),
        spread: distances.reduce((a, b) => a + b * b, 0),
      }
    })
    .sort((a, b) =>
      Math.abs(a.cost - b.cost) > 1e-8
        ? a.cost - b.cost
        : Math.abs(a.spread - b.spread) > 1e-8
          ? a.spread - b.spread
          : a.target - b.target,
    )[0].target
}
const wrap = (n: number, d: ParameterDescriptor) => {
  const a = angle(n)
  return a < d.min ? a + 360 : a > d.max ? a - 360 : a
}
const quantizeCircle = (n: number, d: ParameterDescriptor) =>
  quantize(wrap(Math.round((n - d.min) / d.step) * d.step + d.min, d), d)

export function planConvergence(
  channels: Channel[],
  step: ConvergeStep,
  reference?: Channel,
  masks: ParameterMasks = {},
  previous = new Map<string, ConvergeRemainder>(),
) {
  const moving = channels.filter((c) => c.id !== reference?.id)
  const changes: ConvergeChange[] = [],
    intents: Pick<ConvergeChange, 'channelId' | 'parameter'>[] = []
  const remainders = new Map<string, ConvergeRemainder>()
  const skipped: string[] = []
  const parameters = [
    ...new Set(
      moving
        .flatMap((c) => c.descriptors)
        .filter(
          (d) =>
            isVisibleControl(d) &&
            d.kind === 'number' &&
            !['procEnabled', 'rgbEnabled'].includes(d.id),
        )
        .map((d) => d.id),
    ),
  ]
  for (const parameter of parameters) {
    const members = moving.filter((c) => !masks[c.id]?.length || masks[c.id]!.includes(parameter))
    if (!members.length) continue
    const compatible = reference ? [...members, reference] : members
    const d = members[0].descriptors.find((d) => d.id === parameter)
    if (
      !d ||
      (!reference && members.length < 2) ||
      !isCompatible(compatible, parameter) ||
      compatible.some((c) => !Number.isFinite(c.values[parameter]))
    ) {
      skipped.push(parameter)
      continue
    }
    if (stageIsOff(members, d)) continue
    const circle =
      circular(d) &&
      compatible.every((c) => circular(c.descriptors.find((p) => p.id === parameter)!))
    const values = members.map((c) => c.values[parameter]!)
    const target = reference
      ? reference.values[parameter]!
      : circle
        ? circularMedian(values)
        : median(values)
    const signature = JSON.stringify([
      members.map((c) => [c.id, c.context, c.descriptors.find((d) => d.id === parameter)]),
      reference?.id,
      reference?.context,
      target,
      circle,
    ])
    for (const c of members) {
      const descriptor = c.descriptors.find((d) => d.id === parameter)!,
        before = c.values[parameter]!
      const destination = circle ? quantizeCircle(target, descriptor) : quantize(target, descriptor)
      const distance = circle ? angle(destination - before) : destination - before
      const key = `${c.id}:${parameter}`,
        old = previous.get(key)
      const carry = old?.signature === signature && old.last === before ? old.amount : 0
      const amount = distance * convergeStrength[step] + carry
      let after = circle
        ? quantizeCircle(before + amount, descriptor)
        : quantize(before + amount, descriptor)
      let travelled = circle ? angle(after - before) : after - before
      if (
        Math.sign(travelled) !== Math.sign(distance) ||
        Math.abs(travelled) > Math.abs(distance)
      ) {
        after = Math.sign(travelled) !== Math.sign(distance) ? before : destination
        travelled = circle ? angle(after - before) : after - before
      }
      if (distance && after !== destination)
        remainders.set(key, { last: after, amount: amount - travelled, signature })
      intents.push({ channelId: c.id, parameter })
      if (after !== before)
        changes.push({ channelId: c.id, parameter, before, after, context: c.context })
    }
  }
  return { changes, intents, remainders, skipped }
}
