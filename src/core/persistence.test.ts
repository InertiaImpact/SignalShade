import { describe, expect, it } from 'vitest'
import { demoWorkspace } from './demo'
import { validateWorkspace } from './persistence'

describe('workspace import validation', () => {
  it('round-trips a demo workspace', () => {
    const w = demoWorkspace()
    expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w)
  })
  it('rejects duplicate channel IDs and missing group references', () => {
    const w = demoWorkspace()
    w.channels[1].id = w.channels[0].id
    expect(() => validateWorkspace(w)).toThrow('Duplicate')
    const other = demoWorkspace()
    other.gangs[0].members.push('missing')
    expect(() => validateWorkspace(other)).toThrow('missing')
  })
  it('rejects inverted ranges, zero steps, out-of-range values and NaN', () => {
    const w = demoWorkspace()
    w.channels[0].descriptors[1].step = 0
    expect(() => validateWorkspace(w)).toThrow()
    const v = demoWorkspace()
    v.channels[0].values.gain = 100
    expect(() => validateWorkspace(v)).toThrow('outside range')
    const n = demoWorkspace()
    n.channels[0].values.hue = NaN
    expect(() => validateWorkspace(n)).toThrow()
  })
  it('rejects unknown versions and oversized fleets', () => {
    expect(() => validateWorkspace({ ...demoWorkspace(), version: 2 })).toThrow()
    const w = demoWorkspace()
    w.channels = Array.from({ length: 33 }, (_, i) => ({ ...w.channels[0], id: `ch-${i}` }))
    expect(() => validateWorkspace(w)).toThrow()
  })
  it('strips unrecognized fields instead of importing executable configuration', () => {
    const data = { ...demoWorkspace(), authorization: 'do-not-save', callback: 'code' }
    expect(validateWorkspace(data)).not.toHaveProperty('authorization')
    expect(validateWorkspace(data)).not.toHaveProperty('callback')
  })
})
