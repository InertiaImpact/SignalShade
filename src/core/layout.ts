import { defaultFavorites, sections } from './color'
import type { Channel, ParameterDescriptor, ParameterId, Section, Workspace } from './types'

// Presentation gate only; native values, presets, and adapter mappings remain intact.
export const controlSections: Section[] = ['Proc amp', 'RGB correction']
export const isVisibleControl = (descriptor: ParameterDescriptor) =>
  controlSections.includes(descriptor.section)

export function visibleControlSections(hidden: Section[]) {
  const visible = controlSections.filter((section) => !hidden.includes(section))
  return visible.length ? visible : controlSections
}

export const rgbFamilies = ['Gain', 'Black', 'Gamma'] as const
export type RgbFamily = (typeof rgbFamilies)[number]
export function rgbControls(descriptors: ParameterDescriptor[], family: RgbFamily) {
  return (['red', 'green', 'blue'] as const).flatMap((color) => {
    const descriptor = descriptors.find(
      (d) => d.section === 'RGB correction' && d.id === `${color}${family}`,
    )
    return descriptor ? [descriptor] : []
  })
}
export function availableRgbFamilies(descriptors: ParameterDescriptor[]) {
  return rgbFamilies.filter((family) => rgbControls(descriptors, family).length)
}

export function visibleSections(hidden: Section[]) {
  const visible = sections.filter((section) => !hidden.includes(section))
  // Older layouts could hide everything. Always provide a way back to the controls.
  return visible.length ? visible : sections
}

export function defaultLayout(): Pick<Workspace, 'favorites' | 'density' | 'hiddenSections'> {
  return { favorites: [...defaultFavorites], density: 'comfortable', hiddenSections: [] }
}

export function gangDescriptors(channels: Channel[], mask: ParameterId[] = []) {
  return [...new Map(channels.flatMap((c) => c.descriptors).map((d) => [d.id, d])).values()].filter(
    (d) => isVisibleControl(d) && (!mask.length || mask.includes(d.id)),
  )
}

export function quickControls(
  channel: Pick<Channel, 'descriptors'>,
  favorites: ParameterId[],
): ParameterDescriptor[] {
  const available = channel.descriptors.filter(isVisibleControl)
  const selected = [...new Set(favorites)]
    .map((id) => available.find((descriptor) => descriptor.id === id))
    .filter((descriptor): descriptor is ParameterDescriptor => !!descriptor)
  if (selected.length) return selected
  // Cross-model workspaces can pin parameters that another processor does not expose.
  const fallback = defaultFavorites
    .map((id) => available.find((descriptor) => descriptor.id === id))
    .filter((descriptor): descriptor is ParameterDescriptor => !!descriptor)
  return fallback.length ? fallback : available.slice(0, 4)
}
