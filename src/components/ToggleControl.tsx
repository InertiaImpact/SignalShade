import type { Channel, ParameterDescriptor } from '../core/types'

export function ToggleControl({
  id,
  descriptor,
  channels,
  disabled,
  onSet,
}: {
  id: string
  descriptor: ParameterDescriptor
  channels: Channel[]
  disabled: boolean
  onSet: (value: number) => void
}) {
  const off = channels.filter((c) => c.values[descriptor.id] === 0)
  const on = channels.filter((c) => c.values[descriptor.id] === 1)
  const unknown = channels.length - off.length - on.length
  const allOff = off.length > 0 && off.length === channels.length
  const allOn = on.length > 0 && on.length === channels.length
  const mixed = off.length > 0 && on.length > 0
  const grouped = channels.length > 1
  const status = `${off.length} off, ${on.length} on${unknown ? `, ${unknown} unavailable` : ''}`
  const tickSlot = (members: Channel[] = []) =>
    grouped && (
      <span
        className="state-ticks"
        aria-hidden="true"
        style={{ height: Math.ceil(channels.length / 8) * 6 - 2 }}
      >
        {members.map((c) => (
          <i key={c.id} data-member={c.id} />
        ))}
      </span>
    )
  const setting = (value: number, label: string, members: Channel[], selected: boolean) => (
    <button
      type="button"
      aria-label={`${descriptor.label} ${label}`}
      aria-pressed={selected}
      aria-description={grouped ? `${members.length} of ${channels.length} members` : undefined}
      title={
        grouped ? `${members.length} of ${channels.length} members ${label.toLowerCase()}` : label
      }
      disabled={disabled}
      onClick={() => {
        if (!selected) onSet(value)
      }}
    >
      <span>{label}</span>
      {tickSlot(members)}
    </button>
  )
  return (
    <div id={id} className="state-toggle" role="group" aria-label={`${descriptor.label} state`}>
      {setting(0, 'Off', off, allOff)}
      {(grouped || unknown > 0) && (
        <span
          className={`state-mixed ${!allOff && !allOn ? 'active' : ''}`}
          role={!allOff && !allOn ? 'status' : undefined}
          aria-label={`${descriptor.label}: ${status}`}
          aria-hidden={allOff || allOn ? true : undefined}
          title={`${status}. Mixed is a status; choose On or Off to set all members.`}
        >
          <span>{unknown > 0 && !mixed ? '—' : 'Mixed'}</span>
          {tickSlot()}
        </span>
      )}
      {setting(1, 'On', on, allOn)}
    </div>
  )
}
