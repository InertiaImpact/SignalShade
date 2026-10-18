import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Star } from 'lucide-react'
import { commonValue, formatValue, isCompatible, quantize } from '../core/color'
import { desk } from '../core/store'
import type { Channel, ParameterDescriptor } from '../core/types'

export function ParameterControl({
  descriptor: d,
  channels,
  relative,
  disabled,
  favorite,
  toggleFavorite,
  multiplier,
  compact = false,
  idPrefix,
}: {
  descriptor: ParameterDescriptor
  channels: Channel[]
  relative: boolean
  disabled: boolean
  favorite?: boolean
  toggleFavorite?: () => void
  multiplier: number
  compact?: boolean
  idPrefix?: string
}) {
  const ids = channels.map((c) => c.id),
    current = commonValue(channels, d.id)
  const compatible = isCompatible(channels, d.id)
  const [draft, setDraft] = useState(''),
    [sliding, setSliding] = useState<number | null>(null)
  const focused = useRef(false),
    delta = useRef(0),
    origin = useRef<number | undefined>(undefined),
    gesture = useRef<string | undefined>(undefined)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!focused.current)
      setDraft(relative ? '0' : current === undefined ? '' : current.toFixed(d.precision))
  }, [relative, current, d.precision])
  const send = (value: number, mode: 'relative' | 'absolute', id?: string) =>
    desk.adjust(ids, d.id, value, mode, id)
  const commit = () => {
    focused.current = false
    if (cancelled.current) {
      cancelled.current = false
      setDraft(relative ? '0' : (current?.toFixed(d.precision) ?? ''))
      return
    }
    if (!draft.trim() || !Number.isFinite(Number(draft))) {
      setDraft(relative ? '0' : (current?.toFixed(d.precision) ?? ''))
      return
    }
    const value = Number(draft)
    if (relative ? value !== 0 : value !== current) send(value, relative ? 'relative' : 'absolute')
    if (relative) setDraft('0')
  }
  const finish = () => {
    gesture.current = undefined
    delta.current = 0
    origin.current = undefined
    setSliding(null)
  }
  const nudge = (direction: number) => send(direction * d.step * multiplier, 'relative')
  const rangeSpan = d.step * 10 * multiplier
  const members = channels.flatMap((c) => {
    const value = c.values[d.id]
    return value !== undefined && Number.isFinite(value) ? [{ id: c.id, value }] : []
  })
  const positions = relative && compatible && channels.length > 1 && d.kind === 'number'
  // Member ticks and the handle share the native range. Freeze the reference during a drag;
  // otherwise successive hardware readbacks would change the amount being trimmed.
  const bounds = positions
    ? channels.flatMap((c) => c.descriptors.filter((p) => p.id === d.id))
    : [d]
  const valueMin = Math.min(...bounds.map((p) => p.min)),
    valueMax = Math.max(...bounds.map((p) => p.max))
  const center = members.length
    ? members.reduce((sum, m) => sum + m.value, 0) / members.length
    : d.neutral
  const reference = quantize(center, { ...d, min: valueMin, max: valueMax })
  const toggle = d.kind === 'toggle'
  const mixed = current === undefined
  const lock = disabled || !compatible
  // An absolute group needs a common starting value before an arrow can step it.
  const arrowLock = lock || (!relative && channels.length > 1 && mixed)
  const tone = d.id.startsWith('red')
    ? 'red'
    : d.id.startsWith('green')
      ? 'green'
      : d.id.startsWith('blue')
        ? 'blue'
        : d.id === 'hue'
          ? 'hue'
          : d.id === 'saturation'
            ? 'saturation'
            : d.section === 'Legalizer'
              ? 'legalizer'
              : d.id === 'black'
                ? 'black'
                : 'gain'
  const inputId = (idPrefix ?? (compact ? 'card' : 'detail')) + '-' + channels[0]?.id + '-' + d.id
  const sliderValue = sliding ?? (positions ? reference : relative ? 0 : (current ?? d.neutral))
  const min = positions ? valueMin : relative ? -rangeSpan : d.min,
    max = positions ? valueMax : relative ? rangeSpan : d.max
  return (
    <div
      className={['parameter', 'tone-' + tone, compact ? 'small' : '', lock ? 'disabled' : ''].join(
        ' ',
      )}
    >
      <div className="parameter-heading">
        <label className="function-tag" htmlFor={inputId}>
          {d.label}
        </label>

        {toggle || d.kind === 'enum' ? (
          <select
            id={inputId}
            disabled={lock}
            value={current ?? ''}
            onChange={(e) => send(Number(e.target.value), 'absolute')}
          >
            <option value="" disabled>
              Mixed
            </option>
            {(
              d.choices ?? [
                { value: 0, label: 'Off' },
                { value: 1, label: 'On' },
              ]
            ).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="slider-readout">
            {relative && <span className="delta">Δ</span>}
            <input
              id={inputId}
              aria-label={d.label + (relative ? ' trim' : ' value')}
              inputMode="decimal"
              type="text"
              placeholder={mixed ? 'Mixed' : '—'}
              value={draft}
              disabled={lock}
              onFocus={() => {
                focused.current = true
              }}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  cancelled.current = true
                  e.currentTarget.blur()
                }
              }}
            />
            <span className="unit">{d.unit}</span>
            {mixed && !relative && <span className="mixed-label">Mixed</span>}
          </div>
        )}
        <span className="parameter-actions">
          {toggleFavorite && (
            <button
              className={'icon-button tiny ' + (favorite ? 'favorite' : '')}
              aria-label={(favorite ? 'Unpin ' : 'Pin ') + d.label}
              onClick={toggleFavorite}
            >
              <Star size={12} fill={favorite ? 'currentColor' : 'none'} />
            </button>
          )}
          <button
            className="icon-button tiny"
            disabled={lock}
            title={'Reset ' + d.label + ' to ' + formatValue(d.neutral, d)}
            aria-label={'Reset ' + d.label}
            onClick={() => send(d.neutral, 'absolute')}
          >
            <RotateCcw size={12} />
          </button>
        </span>
      </div>
      {!toggle && d.kind !== 'enum' && (
        <>
          <div className="slider-control">
            <button
              aria-label={'Decrease ' + d.label}
              title={
                arrowLock && mixed
                  ? 'Mixed values: set a value first or use Relative trim'
                  : 'Trim −' + d.step * multiplier + ' ' + d.unit
              }
              disabled={arrowLock}
              onClick={() => nudge(-1)}
            >
              <ChevronLeft size={15} />
            </button>
            <div className={`slider-track ${positions ? 'has-member-ticks' : ''}`}>
              {positions && (
                <div className="member-ticks" aria-hidden="true">
                  {members.map((member) => (
                    <span
                      key={member.id}
                      className="member-tick"
                      data-member={member.id}
                      style={{
                        left: `${100 * Math.max(0, Math.min(1, (member.value - min) / (max - min)))}%`,
                      }}
                    />
                  ))}
                </div>
              )}
              <input
                className="color-slider"
                aria-label={d.label + ' slider'}
                title={
                  positions
                    ? 'Ticks show member positions. Drag to trim all members together.'
                    : undefined
                }
                aria-valuetext={
                  relative
                    ? (positions
                        ? sliding === null
                          ? 0
                          : sliderValue - (origin.current ?? reference)
                        : sliderValue
                      ).toFixed(d.precision) + ' relative trim'
                    : mixed && sliding === null
                      ? 'Mixed values; move to set all'
                      : sliderValue + ' ' + d.unit
                }
                type="range"
                min={min}
                max={max}
                step={d.step}
                disabled={lock}
                value={sliderValue}
                style={
                  {
                    '--slider-fill': (100 * (sliderValue - min)) / (max - min) + '%',
                  } as CSSProperties
                }
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  if (positions) origin.current = reference
                  gesture.current = crypto.randomUUID()
                }}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  if (positions) origin.current ??= reference
                  const trim = positions ? value - origin.current! : value
                  setSliding(value)
                  gesture.current ??= crypto.randomUUID()
                  send(
                    relative ? trim - delta.current : value,
                    relative ? 'relative' : 'absolute',
                    gesture.current,
                  )
                  delta.current = trim
                }}
                onPointerUp={finish}
                onPointerCancel={finish}
                onKeyUp={finish}
                onBlur={finish}
              />
            </div>
            <button
              aria-label={'Increase ' + d.label}
              title={
                arrowLock && mixed
                  ? 'Mixed values: set a value first or use Relative trim'
                  : 'Trim +' + d.step * multiplier + ' ' + d.unit
              }
              disabled={arrowLock}
              onClick={() => nudge(1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          {(!compact || !compatible) && (
            <div className="parameter-hint">
              <span>
                {!compatible
                  ? 'Not supported by every member'
                  : relative
                    ? positions
                      ? `${members.length} members`
                      : 'Members: ' + formatValue(current, d)
                    : d.min + ' — ' + d.max}
              </span>
              <span>{relative ? 'Relative trim' : 'Step ' + d.step}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
