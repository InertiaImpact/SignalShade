import { desk } from '../core/store'
import type { ParameterMasks, Workspace } from '../core/types'

export function ConvergeControls({
  ids,
  workspace,
  masks,
  disabled,
  busy,
  compact = false,
}: {
  ids: string[]
  workspace: Workspace
  masks?: ParameterMasks
  disabled: boolean
  busy: boolean
  compact?: boolean
}) {
  const reference = workspace.channels.find((c) => c.id === workspace.convergeTargetId)
  const selected = workspace.channels.filter((c) => ids.includes(c.id))
  const moving = selected.filter((c) => c.id !== reference?.id)
  const blocked =
    disabled ||
    busy ||
    selected.length < 2 ||
    !moving.length ||
    moving.some((c) => {
      const device = workspace.devices.find((d) => d.id === c.deviceId)
      return c.locked || !!c.issue || !c.updatedAt || !device?.armed || device.status !== 'online'
    }) ||
    (!!reference && workspace.devices.find((d) => d.id === reference.deviceId)?.status !== 'online')
  const destination = reference
    ? `${reference.label} (target unchanged)`
    : 'each control’s group median'
  return (
    <div
      className={`converge-controls ${compact ? 'compact-converge' : ''}`}
      role="group"
      aria-label="Converge controls"
    >
      <span>Converge</span>
      <div className="segmented">
        {(['small', 'large'] as const).map((step) => (
          <button
            key={step}
            disabled={blocked}
            aria-label={`Converge ${step} step`}
            title={`Move ${step === 'small' ? '5%' : '20%'} toward ${destination}. Applies to supported numeric color controls; gang masks apply.`}
            onClick={() => void desk.converge(ids, step, masks)}
          >
            {compact ? (step === 'small' ? 'S' : 'L') : step === 'small' ? 'Small' : 'Large'}
          </button>
        ))}
      </div>
    </div>
  )
}
