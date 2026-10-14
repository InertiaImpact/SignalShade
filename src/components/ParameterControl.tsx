import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, RotateCcw, Star } from 'lucide-react'
import { commonValue, formatValue, isCompatible } from '../core/color'
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
}: {
  descriptor: ParameterDescriptor
  channels: Channel[]
  relative: boolean
  disabled: boolean
  favorite?: boolean
  toggleFavorite?: () => void
  multiplier: number
  compact?: boolean
}) {
  const ids = channels.map((c) => c.id),
    current = commonValue(channels, d.id)
  const compatible = isCompatible(channels, d.id)
  const [draft, setDraft] = useState(''),
    [sliding, setSliding] = useState<number | null>(null)
  const focused = useRef(false),
    delta = useRef(0),
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
    setSliding(null)
  }
  const nudge = (direction: number) => send(direction * d.step * multiplier, 'relative')
  const rangeSpan = d.step * 10 * multiplier
  const values = channels.map((c) => c.values[d.id]).filter((v): v is number => v !== undefined)
  const toggle = d.kind === 'toggle'
  const mixed = current === undefined
  const lock = disabled || !compatible
  return (
    <div className={`parameter ${compact ? 'small' : ''} ${lock ? 'disabled' : ''}`}>
      <div className="parameter-title">
        <label htmlFor={`${compact ? 'card' : 'detail'}-${channels[0]?.id}-${d.id}`}>
          {d.label}
        </label>
        <span className="parameter-actions">
          {toggleFavorite && (
            <button
              className={`icon-button tiny ${favorite ? 'favorite' : ''}`}
              aria-label={`${favorite ? 'Unpin' : 'Pin'} ${d.label}`}
              onClick={toggleFavorite}
            >
              <Star size={12} fill={favorite ? 'currentColor' : 'none'} />
            </button>
          )}
          {!compact && (
            <button
              className="icon-button tiny"
              disabled={lock}
              title={`Reset ${d.label} to ${formatValue(d.neutral, d)}`}
              aria-label={`Reset ${d.label}`}
              onClick={() => send(d.neutral, 'absolute')}
            >
              <RotateCcw size={12} />
            </button>
          )}
        </span>
      </div>
      {toggle || d.kind === 'enum' ? (
        <select
          id={`${compact ? 'card' : 'detail'}-${channels[0]?.id}-${d.id}`}
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
        <>
          <div className="number-control">
            <button
              aria-label={`Decrease ${d.label}`}
              disabled={lock}
              onClick={(e) => {
                e.stopPropagation()
                nudge(-1)
              }}
            >
              <Minus size={12} />
            </button>
            <div className="number-value">
              {relative && <span className="delta">Δ</span>}
              <input
                id={`${compact ? 'card' : 'detail'}-${channels[0]?.id}-${d.id}`}
                aria-label={`${d.label} ${relative ? 'trim' : 'value'}`}
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
            </div>
            <button
              aria-label={`Increase ${d.label}`}
              disabled={lock}
              onClick={(e) => {
                e.stopPropagation()
                nudge(1)
              }}
            >
              <Plus size={12} />
            </button>
          </div>
          {!compact && (
            <input
              className={`color-slider ${d.id.startsWith('red') ? 'red' : d.id.startsWith('green') ? 'green' : d.id.startsWith('blue') ? 'blue' : ''}`}
              aria-label={`${d.label} slider`}
              type="range"
              min={relative ? -rangeSpan : d.min}
              max={relative ? rangeSpan : d.max}
              step={d.step}
              disabled={lock}
              value={sliding ?? (relative ? 0 : (current ?? d.neutral))}
              onPointerDown={() => {
                gesture.current = crypto.randomUUID()
              }}
              onChange={(e) => {
                const value = Number(e.target.value)
                setSliding(value)
                gesture.current ??= crypto.randomUUID()
                send(
                  relative ? value - delta.current : value,
                  relative ? 'relative' : 'absolute',
                  gesture.current,
                )
                delta.current = value
              }}
              onPointerUp={finish}
              onPointerCancel={finish}
              onKeyUp={finish}
              onBlur={finish}
            />
          )}
          {!compact && (
            <div className="parameter-hint">
              <span>
                {!compatible
                  ? 'Not supported by every member'
                  : relative
                    ? mixed && values.length
                      ? `Members: ${Math.min(...values).toFixed(d.precision)} … ${Math.max(...values).toFixed(d.precision)}`
                      : `Members: ${formatValue(current, d)}`
                    : `${d.min} — ${d.max}`}
              </span>
              <span>{relative ? 'Relative trim' : `Step ${d.step}`}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
