import { useEffect, useState } from 'react'
import { Circle, Square } from 'lucide-react'
import { desk } from '../core/store'
import type { RecorderConfig, RecorderSnapshot } from '../recorders/types'

export function RecorderTransport({
  config,
  snapshot,
  readOnly,
  now = Date.now(),
  compact = false,
}: {
  config: RecorderConfig
  snapshot: RecorderSnapshot
  readOnly: boolean
  now?: number
  compact?: boolean
}) {
  const [confirm, setConfirm] = useState<{ until: number; recordingId?: string }>()
  const stale = !snapshot.updatedAt || now - snapshot.updatedAt > 10000
  const recording = snapshot.state === 'recording' || snapshot.state === 'paused'
  const disabled =
    readOnly ||
    stale ||
    !snapshot.enabled ||
    !snapshot.canControl ||
    !!snapshot.pending ||
    (snapshot.state !== 'idle' && !recording)
  useEffect(() => {
    setConfirm(undefined)
  }, [config.id, snapshot.state, snapshot.recordingId, disabled])
  useEffect(() => {
    if (!confirm) return
    const timer = setTimeout(() => setConfirm(undefined), confirm.until - Date.now())
    return () => clearTimeout(timer)
  }, [confirm])

  const confirming = confirm && confirm.until > now && confirm.recordingId === snapshot.recordingId
  const label = snapshot.pending
    ? 'Wait'
    : confirming
      ? 'Confirm stop'
      : recording
        ? 'Stop'
        : 'Record'
  const name = `${label} ${config.label}`
  return (
    <button
      className={`button recorder-transport ${compact ? 'compact-transport' : ''} ${confirming ? 'danger' : ''}`}
      disabled={disabled}
      aria-label={name}
      title={
        disabled
          ? (snapshot.issue ??
            (readOnly ? 'Desk locked' : 'Enable control in Devices after connecting'))
          : `${name} · ${snapshot.scope}`
      }
      onClick={() => {
        const clickedAt = Date.now()
        if (clickedAt - snapshot.updatedAt > 10000) return
        if (recording && (!confirming || confirm.until <= clickedAt)) {
          setConfirm({ until: clickedAt + 4000, recordingId: snapshot.recordingId })
          return
        }
        void desk.recorders.command(
          config.id,
          recording ? 'stop' : 'record',
          recording ? confirm?.recordingId : undefined,
        )
        setConfirm(undefined)
      }}
    >
      {recording ? <Square size={12} /> : <Circle size={12} />}
      {(!compact || confirming) && label}
    </button>
  )
}
