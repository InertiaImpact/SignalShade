import { describe, expect, it } from 'vitest'
import { demoWorkspace } from './demo'
import { sections } from './color'
import {
  defaultLayout,
  quickControls,
  visibleSections,
  visibleControlSections,
  availableRgbFamilies,
  rgbControls,
} from './layout'
import { validateWorkspace } from './persistence'

describe('recoverable control layout', () => {
  it('restores tabs from a saved layout with every section hidden without altering signal settings', () => {
    const workspace = demoWorkspace()
    workspace.hiddenSections = [...sections]
    const restored = validateWorkspace(workspace)
    expect(restored.hiddenSections).toEqual([])
    expect(restored.channels).toEqual(workspace.channels)
    expect(restored.gangs).toEqual(workspace.gangs)
    expect(visibleSections(sections)).toEqual(sections)
  })
  it('keeps valid section visibility preferences', () => {
    expect(visibleSections(['RGB correction'])).toEqual(['Proc amp', 'Legalizer'])
  })
  it('keeps quick controls in selection order and falls back on heterogeneous processors', () => {
    const channel = demoWorkspace().channels[0]
    expect(quickControls(channel, ['hue', 'gain', 'hue']).map((d) => d.id)).toEqual(['hue', 'gain'])
    channel.descriptors = channel.descriptors.filter((d) => d.section === 'Proc amp')
    expect(quickControls(channel, ['redGamma']).map((d) => d.id)).toEqual([
      'gain',
      'black',
      'saturation',
      'hue',
    ])
    channel.descriptors = []
    expect(quickControls(channel, ['gain'])).toEqual([])
  })
  it('resets only presentation preferences', () => {
    const original = demoWorkspace()
    const restored = { ...original, ...defaultLayout() }
    expect(restored.channels).toEqual(original.channels)
    expect(restored.gangs).toEqual(original.gangs)
    expect(restored.favorites).toEqual(['gain', 'black', 'saturation', 'hue'])
  })
  it('shows RGB families in Red / Green / Blue order without unsupported controls', () => {
    const descriptors = [...demoWorkspace().channels[0].descriptors].reverse()
    expect(availableRgbFamilies(descriptors)).toEqual(['Gain', 'Black', 'Gamma'])
    for (const family of ['Gain', 'Black', 'Gamma'] as const)
      expect(rgbControls(descriptors, family).map((d) => d.id)).toEqual([
        `red${family}`,
        `green${family}`,
        `blue${family}`,
      ])
    const partial = descriptors.filter((d) => d.id === 'blueBlack')
    expect(availableRgbFamilies(partial)).toEqual(['Black'])
    expect(rgbControls(partial, 'Gain')).toEqual([])
  })
  it('hides Legalizer even for old pins and layouts that exposed only that section', () => {
    const channel = demoWorkspace().channels[0]
    expect(visibleControlSections([])).toEqual(['Proc amp', 'RGB correction'])
    expect(visibleControlSections(['Proc amp', 'RGB correction'])).toEqual([
      'Proc amp',
      'RGB correction',
    ])
    expect(quickControls(channel, ['legalizer.white']).map((d) => d.id)).toEqual([
      'gain',
      'black',
      'saturation',
      'hue',
    ])
    expect(quickControls(channel, ['gain', 'legalizer.white']).map((d) => d.id)).toEqual(['gain'])
    expect(channel.values['legalizer.white']).toBe(100)
  })
})
