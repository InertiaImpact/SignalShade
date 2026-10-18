import type { Channel, ParameterDescriptor, ParameterId } from '../core/types'
import { ParameterControl } from './ParameterControl'

export function QuickStageControls({
  descriptors,
  channels,
  disabled,
  editableIds,
  idPrefix,
}: {
  descriptors: ParameterDescriptor[]
  channels: Channel[]
  disabled: boolean
  editableIds?: ParameterId[]
  idPrefix: string
}) {
  if (!descriptors.length) return null
  return (
    <div className="quick-stage-controls" role="group" aria-label="Quick stage controls">
      {descriptors.map((d) => (
        <div
          key={d.id}
          title={
            editableIds && !editableIds.includes(d.id)
              ? 'Stage state — enable control is outside this gang’s parameter mask'
              : undefined
          }
        >
          <ParameterControl
            descriptor={d}
            channels={channels}
            relative={false}
            disabled={disabled || (!!editableIds && !editableIds.includes(d.id))}
            multiplier={1}
            compact
            hideReset
            idPrefix={idPrefix}
          />
        </div>
      ))}
    </div>
  )
}
