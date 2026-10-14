import type { Channel, ParameterDescriptor, ParameterId, Section } from './types'

const numeric = (
  id: ParameterId,
  label: string,
  section: Section,
  min: number,
  max: number,
  step: number,
  neutral: number,
  unit = '',
): ParameterDescriptor => ({
  id,
  label,
  section,
  min,
  max,
  step,
  neutral,
  unit,
  precision: step < 1 ? (step < 0.1 ? 2 : 1) : 0,
  kind: 'number',
})
export const parameters: ParameterDescriptor[] = [
  { ...numeric('procEnabled', 'Proc amp', 'Proc amp', 0, 1, 1, 0), kind: 'toggle' },
  numeric('gain', 'Gain', 'Proc amp', 0, 1.5, 0.01, 1, '×'),
  numeric('black', 'Black', 'Proc amp', -20, 20, 0.5, 0, 'IRE'),
  numeric('hue', 'Hue', 'Proc amp', -179, 180, 1, 0, '°'),
  numeric('saturation', 'Saturation', 'Proc amp', 0, 1.5, 0.01, 1, '×'),
  { ...numeric('rgbEnabled', 'RGB correction', 'RGB correction', 0, 1, 1, 0), kind: 'toggle' },
  ...(['red', 'green', 'blue'] as const).flatMap((color) => [
    numeric(
      `${color}Gain`,
      `${color[0].toUpperCase()}${color.slice(1)} gain`,
      'RGB correction',
      0,
      1.5,
      0.01,
      1,
      '×',
    ),
    numeric(
      `${color}Black`,
      `${color[0].toUpperCase()}${color.slice(1)} black`,
      'RGB correction',
      -20,
      20,
      0.5,
      0,
      'IRE',
    ),
    numeric(
      `${color}Gamma`,
      `${color[0].toUpperCase()}${color.slice(1)} gamma`,
      'RGB correction',
      -1,
      1,
      0.01,
      0,
    ),
  ]),
  {
    ...numeric('legalizer.mode', 'Legalizer mode', 'Legalizer', 0, 2, 1, 0),
    kind: 'enum',
    choices: [
      { value: 0, label: 'Off' },
      { value: 1, label: 'YUV' },
      { value: 2, label: 'RGB' },
    ],
  },
  numeric('legalizer.white', 'White clip', 'Legalizer', 90, 110, 0.5, 100, 'IRE'),
  numeric('legalizer.black', 'Black clip', 'Legalizer', -10, 10, 0.5, 0, 'IRE'),
  numeric('legalizer.chroma', 'Chroma clip', 'Legalizer', 80, 120, 0.5, 100, '%'),
]
export const sections: Section[] = ['Proc amp', 'RGB correction', 'Legalizer']
export const defaultFavorites: ParameterId[] = ['gain', 'black', 'saturation', 'hue']
export function quantize(value: number, d: ParameterDescriptor): number {
  if (!Number.isFinite(value)) throw new Error('Enter a finite number')
  const bounded = Math.max(d.min, Math.min(d.max, value))
  const result = Number((Math.round((bounded - d.min) / d.step) * d.step + d.min).toFixed(8))
  return Math.max(d.min, Math.min(d.max, result))
}
export function formatValue(value: number | undefined, d: ParameterDescriptor) {
  if (value === undefined) return '—'
  if (d.kind === 'toggle') return value ? 'On' : 'Off'
  if (d.choices) return d.choices.find((c) => c.value === value)?.label ?? String(value)
  return value.toFixed(d.precision)
}
export function isCompatible(channels: Channel[], id: ParameterId): boolean {
  const descriptors = channels.map((c) => c.descriptors.find((d) => d.id === id))
  const first = descriptors[0]
  return (
    !!first &&
    descriptors.every(
      (d) =>
        d &&
        d.unit === first.unit &&
        d.kind === first.kind &&
        d.scale === first.scale &&
        d.offset === first.offset &&
        (d.kind !== 'enum' || JSON.stringify(d.choices) === JSON.stringify(first.choices)),
    )
  )
}
export function commonValue(channels: Channel[], id: ParameterId): number | undefined {
  const values = channels.map((c) => c.values[id])
  return values.length && values.every((v) => v === values[0]) ? values[0] : undefined
}
