import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { availableRgbFamilies, rgbControls, type RgbFamily } from '../core/layout'
import type { Channel, ParameterDescriptor, ParameterId, Section } from '../core/types'
import { ParameterControl } from './ParameterControl'
import { RgbTabs } from './RgbTabs'

export function GangControls({
  descriptors,
  sections,
  channels,
  relative,
  disabled,
  multiplier,
  favorites,
  toggleFavorite,
  onReset,
}: {
  descriptors: ParameterDescriptor[]
  sections: Section[]
  channels: Channel[]
  relative: boolean
  disabled: boolean
  multiplier: number
  favorites: ParameterId[]
  toggleFavorite?: (id: ParameterId) => void
  onReset: (section: Section) => void
}) {
  const [family, setFamily] = useState<RgbFamily>('Gain')
  const families = availableRgbFamilies(descriptors)
  const activeFamily = families.includes(family) ? family : (families[0] ?? 'Gain')
  const targetKey = channels.map((c) => c.id).join('|')
  const control = (d: ParameterDescriptor, enable = false) => (
    <ParameterControl
      key={`${targetKey}-${d.id}-${enable ? 'enable' : relative}`}
      descriptor={d}
      channels={channels}
      relative={!enable && relative && d.kind === 'number'}
      disabled={disabled}
      multiplier={multiplier}
      favorite={enable ? undefined : favorites.includes(d.id)}
      toggleFavorite={!enable && toggleFavorite ? () => toggleFavorite(d.id) : undefined}
    />
  )

  return (
    <div className="gang-controls">
      {sections.map((section) => {
        const rgb = section === 'RGB correction'
        const fields = descriptors.filter((d) => d.section === section)
        const enable = fields.find((d) => d.id === (rgb ? 'rgbEnabled' : 'procEnabled'))
        return (
          <section
            key={section}
            className={`gang-control-section ${rgb ? 'gang-rgb' : 'gang-procamp'}`}
            aria-label={`Group ${section}`}
          >
            <div className="gang-section-heading">
              <h3>{rgb ? 'RGB' : section}</h3>
              <button
                className="icon-button tiny"
                disabled={disabled}
                aria-label={`Reset ${section} section`}
                title={`Reset ${section}`}
                onClick={() => onReset(section)}
              >
                <RotateCcw size={13} />
              </button>
            </div>
            <div className="gang-section-enable">{enable && control(enable, true)}</div>
            {rgb ? (
              <>
                {!!families.length && (
                  <div className="gang-rgb-toggle">
                    <RgbTabs
                      descriptors={fields}
                      value={activeFamily}
                      onChange={setFamily}
                      label="Gang RGB controls"
                    />
                  </div>
                )}
                <div className="gang-rgb-families">
                  {families.map((f) => (
                    <div
                      key={f}
                      className={`gang-rgb-family ${f === activeFamily ? 'active' : ''}`}
                      role="group"
                      aria-label={`RGB ${f}`}
                    >
                      <h4>{f}</h4>
                      {rgbControls(fields, f).map((d) => control(d))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="gang-procamp-fields">
                {fields.filter((d) => d !== enable).map((d) => control(d))}
              </div>
            )}
          </section>
        )
      })}
      {!sections.length && <p className="muted">No controls available for the selected target.</p>}
    </div>
  )
}
