import { availableRgbFamilies, type RgbFamily } from '../core/layout'
import type { ParameterDescriptor } from '../core/types'

export function RgbTabs({
  descriptors,
  value,
  onChange,
  label,
}: {
  descriptors: ParameterDescriptor[]
  value: RgbFamily
  onChange: (value: RgbFamily) => void
  label: string
}) {
  return (
    <div className="rgb-tabs" role="tablist" aria-label={label}>
      {availableRgbFamilies(descriptors).map((family) => (
        <button
          key={family}
          role="tab"
          aria-selected={value === family}
          onClick={() => onChange(family)}
        >
          {family}
        </button>
      ))}
    </div>
  )
}
