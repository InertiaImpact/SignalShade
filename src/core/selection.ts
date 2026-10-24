import type { ParameterId, ParameterMasks, Workspace } from './types'

/** Tokens remain gangs or individuals; overlapping memberships expand only once. */
export function resolveSelection(workspace: Workspace, tokens: string[]) {
  const masks: ParameterMasks = {}
  for (const token of new Set(tokens)) {
    const gang = workspace.gangs.find((g) => g.id === token)
    const members = gang?.members ?? (workspace.channels.some((c) => c.id === token) ? [token] : [])
    for (const id of members) {
      const mask = gang?.parameters.length ? gang.parameters : undefined
      if (!(id in masks)) masks[id] = mask && [...mask]
      else if (!mask || !masks[id]) masks[id] = undefined
      else masks[id] = [...new Set([...(masks[id] as ParameterId[]), ...mask])]
    }
  }
  return { channels: workspace.channels.filter((c) => c.id in masks), masks }
}

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
