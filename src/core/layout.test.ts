import { describe, expect, it } from 'vitest'
import { demoWorkspace } from './demo'
import { sections } from './color'
import { defaultLayout, quickControls, visibleSections } from './layout'
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
})
