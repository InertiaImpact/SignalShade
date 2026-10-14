export interface SelectionRect {
  left: number
  top: number
  right: number
  bottom: number
}
export function selectionRect(x1: number, y1: number, x2: number, y2: number): SelectionRect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  }
}
export function intersects(a: SelectionRect, b: SelectionRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}
export function toggleSelection(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
}
export function combineSelection(base: string[], hits: string[], additive: boolean) {
  return [...new Set(additive ? [...base, ...hits] : hits)]
}
