import { describe, expect, it } from 'vitest'
import { commonValue, isCompatible, parameters, quantize } from './color'
import { demoWorkspace } from './demo'

describe('color calculations', () => {
  it('clamps independently without moving members that reach a limit', () => {
    const d = parameters.find((d) => d.id === 'gain')!
    expect([1.49, 1.1, 0.95].map((v) => quantize(v + 0.03, d))).toEqual([1.5, 1.13, 0.98])
  })
  it('rounds on the device-native step including negative minima', () => {
    const black = parameters.find((d) => d.id === 'black')!
    expect(quantize(-0.76, black)).toBe(-1)
    expect(quantize(-100, black)).toBe(-20)
    expect(
      quantize(
        0.003 + 0.01,
        parameters.find((d) => d.id === 'redGamma')!,
      ),
    ).toBe(0.01)
  })
  it('rejects nonfinite values instead of sending them', () => {
    expect(() => quantize(NaN, parameters[1])).toThrow()
    expect(() => quantize(Infinity, parameters[1])).toThrow()
  })
  it('shows mixed values and excludes incompatible parameters', () => {
    const channels = demoWorkspace().channels.slice(0, 2)
    expect(commonValue(channels, 'gain')).toBeUndefined()
    expect(commonValue(channels, 'hue')).toBe(0)
    expect(isCompatible(channels, 'gain')).toBe(true)
    channels[1].descriptors = channels[1].descriptors.filter((d) => d.id !== 'gain')
    expect(isCompatible(channels, 'gain')).toBe(false)
  })
  it('does not equate different units or enum meanings', () => {
    const channels = demoWorkspace().channels.slice(0, 2)
    channels[1].descriptors.find((d) => d.id === 'gain')!.unit = 'native'
    expect(isCompatible(channels, 'gain')).toBe(false)
    channels[1].descriptors.find((d) => d.id === 'legalizer.mode')!.choices![1].label = 'Other mode'
    expect(isCompatible(channels, 'legalizer.mode')).toBe(false)
  })
  it('blocks group controls when native scaling differs', () => {
    const channels = demoWorkspace().channels.slice(0, 2)
    channels[0].descriptors.find((d) => d.id === 'gain')!.scale = 0.01
    channels[1].descriptors.find((d) => d.id === 'gain')!.scale = 0.001
    expect(isCompatible(channels, 'gain')).toBe(false)
  })
})
