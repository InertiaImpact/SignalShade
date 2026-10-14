import { defaultFavorites, sections } from './color'
import type { Channel, ParameterDescriptor, ParameterId, Section, Workspace } from './types'

export function visibleSections(hidden: Section[]) {
  const visible = sections.filter((section) => !hidden.includes(section))
  // Older layouts could hide everything. Always provide a way back to the controls.
  return visible.length ? visible : sections
}

export function defaultLayout(): Pick<Workspace, 'favorites' | 'density' | 'hiddenSections'> {
  return { favorites: [...defaultFavorites], density: 'comfortable', hiddenSections: [] }
}

export function quickControls(channel: Channel, favorites: ParameterId[]): ParameterDescriptor[] {
  const selected = [...new Set(favorites)]
    .map((id) => channel.descriptors.find((descriptor) => descriptor.id === id))
    .filter((descriptor): descriptor is ParameterDescriptor => !!descriptor)
  if (selected.length) return selected
  // Cross-model workspaces can pin parameters that another processor does not expose.
  const fallback = defaultFavorites
    .map((id) => channel.descriptors.find((descriptor) => descriptor.id === id))
    .filter((descriptor): descriptor is ParameterDescriptor => !!descriptor)
  return fallback.length ? fallback : channel.descriptors.slice(0, 4)
}
