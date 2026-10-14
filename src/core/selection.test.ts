import { describe, expect, it } from 'vitest'
import { combineSelection, intersects, selectionRect, toggleSelection } from './selection'
describe('channel selection', () => {
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
