import type { Workspace } from './types'

export const customViewKey = (id: string) => `view:${id}`
export const gangViewKey = (id: string) => `gang:${id}`
export const deviceViewKey = (id: string) => `device:${id}`

export function cardsInView(workspace: Workspace, view: string): string[] {
  const custom = workspace.views?.find((item) => customViewKey(item.id) === view)
  if (custom) return [...custom.cards]
  const gang = workspace.gangs.find((item) => gangViewKey(item.id) === view)
  const device = workspace.devices.find((item) => deviceViewKey(item.id) === view)
  const defaults = gang
    ? [gang.id, ...workspace.channels.filter((c) => gang.members.includes(c.id)).map((c) => c.id)]
    : [
        ...(view === 'all' ? workspace.gangs.filter((g) => g.showAsCard).map((g) => g.id) : []),
        ...workspace.channels.filter((c) => !device || c.deviceId === device.id).map((c) => c.id),
      ]
  const available = new Set(defaults)
  return [
    ...new Set([
      ...(workspace.cardOrders?.[view] ?? []).filter((id) => available.has(id)),
      ...defaults,
    ]),
  ]
}

export function pruneViewCards(workspace: Workspace) {
  const ids = new Set([...workspace.channels, ...workspace.gangs].map((card) => card.id))
  const keys = new Set([
    'all',
    'favorites',
    ...workspace.gangs.map((g) => gangViewKey(g.id)),
    ...workspace.devices.map((d) => deviceViewKey(d.id)),
  ])
  return {
    views: workspace.views?.map((view) => ({
      ...view,
      cards: [...new Set(view.cards.filter((id) => ids.has(id)))],
    })),
    cardOrders:
      workspace.cardOrders &&
      Object.fromEntries(
        Object.entries(workspace.cardOrders)
          .filter(([key]) => keys.has(key))
          .map(([key, order]) => [key, [...new Set(order.filter((id) => ids.has(id)))]]),
      ),
  }
}
