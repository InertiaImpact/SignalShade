import type { Workspace } from './types'

export const customViewKey = (id: string) => `view:${id}`
export const gangViewKey = (id: string) => `gang:${id}`
export const deviceViewKey = (id: string) => `device:${id}`
export const maxViewSpacers = 32
export const maxSpacerRows = 8
export const minBarHeight = 18
export const maxBarHeight = 600

export function cardsInView(workspace: Workspace, view: string): string[] {
  const custom = workspace.views?.find((item) => customViewKey(item.id) === view)
  if (custom) return [...custom.cards]
  const gang = workspace.gangs.find((item) => gangViewKey(item.id) === view)
  const device = workspace.devices.find((item) => deviceViewKey(item.id) === view)
  const visibility = workspace.gangCardVisibility?.[view]
  const includedGangs = workspace.gangs.filter((item) =>
    view === 'all' ? item.showAsCard : (visibility?.[item.id] ?? item.id === gang?.id),
  )
  const defaults = [
    ...includedGangs.map((item) => item.id),
    ...workspace.channels
      .filter(
        (c) => (!gang || gang.members.includes(c.id)) && (!device || c.deviceId === device.id),
      )
      .map((c) => c.id),
    ...(workspace.viewSpacers?.[view] ?? []).map((spacer) => spacer.id),
  ]
  if (gang && includedGangs.some((item) => item.id === gang.id)) {
    defaults.splice(defaults.indexOf(gang.id), 1)
    defaults.unshift(gang.id)
  }
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
  const gangIds = new Set(workspace.gangs.map((g) => g.id))
  const viewSpacers =
    workspace.viewSpacers &&
    Object.fromEntries(
      Object.entries(workspace.viewSpacers)
        .filter(
          ([key]) =>
            keys.has(key) || workspace.views?.some((view) => customViewKey(view.id) === key),
        )
        .map(([key, spacers]) => [
          key,
          [
            ...new Map(
              spacers.filter((item) => !ids.has(item.id)).map((item) => [item.id, item]),
            ).values(),
          ],
        ]),
    )
  const validCards = (order: string[], key: string) => {
    const spacers = new Set(viewSpacers?.[key]?.map((item) => item.id))
    return [...new Set(order.filter((id) => ids.has(id) || spacers.has(id)))]
  }
  return {
    viewSpacers,
    views: workspace.views?.map((view) => ({
      ...view,
      cards: validCards(view.cards, customViewKey(view.id)),
    })),
    cardOrders:
      workspace.cardOrders &&
      Object.fromEntries(
        Object.entries(workspace.cardOrders)
          .filter(([key]) => keys.has(key))
          .map(([key, order]) => [key, validCards(order, key)]),
      ),
    gangCardVisibility:
      workspace.gangCardVisibility &&
      Object.fromEntries(
        Object.entries(workspace.gangCardVisibility)
          .filter(([key]) => key !== 'all' && keys.has(key))
          .map(([key, visibility]) => [
            key,
            Object.fromEntries(Object.entries(visibility).filter(([id]) => gangIds.has(id))),
          ]),
      ),
  }
}
