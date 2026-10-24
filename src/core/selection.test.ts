import { describe, expect, it } from 'vitest'
import {
  combineSelection,
  intersects,
  resolveSelection,
  selectionRect,
  toggleSelection,
} from './selection'
import { demoWorkspace } from './demo'
describe('channel selection', () => {
  it('combines gangs and individuals once and unions their allowed controls per channel', () => {
    const w = demoWorkspace()
    w.gangs[0].members = ['demo-ch-1', 'demo-ch-2']
    w.gangs[0].parameters = ['gain']
    w.gangs[1].members = ['demo-ch-2', 'demo-ch-3']
    w.gangs[1].parameters = ['black']
    const resolved = resolveSelection(w, [w.gangs[0].id, w.gangs[1].id, 'demo-ch-4', w.gangs[0].id])
    expect(resolved.channels.map((c) => c.id)).toEqual([
      'demo-ch-1',
      'demo-ch-2',
      'demo-ch-3',
      'demo-ch-4',
    ])
    expect(resolved.masks).toEqual({
      'demo-ch-1': ['gain'],
      'demo-ch-2': ['gain', 'black'],
      'demo-ch-3': ['black'],
      'demo-ch-4': undefined,
    })
    expect(resolveSelection(w, [w.gangs[0].id, 'demo-ch-1']).masks['demo-ch-1']).toBeUndefined()
    expect(resolveSelection(w, ['missing']).channels).toEqual([])
  })
  it('selects intersections in either drag direction without including adjacent cards', () => {
    const rect = selectionRect(300, 250, 100, 50)
    expect(intersects(rect, { left: 80, top: 40, right: 120, bottom: 100 })).toBe(true)
    expect(intersects(rect, { left: 300, top: 50, right: 400, bottom: 250 })).toBe(false)
    expect(intersects(rect, { left: 110, top: 260, right: 200, bottom: 300 })).toBe(false)
  })
  it('toggles membership and permits clearing the last channel', () => {
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleSelection(['a'], 'a')).toEqual([])
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('keeps additive marquee membership unique and replaces without a modifier', () => {
    expect(combineSelection(['a', 'b'], ['b', 'c'], true)).toEqual(['a', 'b', 'c'])
    expect(combineSelection(['a'], ['c'], false)).toEqual(['c'])
    expect(combineSelection(['a'], [], false)).toEqual([])
  })
})
