import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronDown, Circle, Square } from 'lucide-react'
import { desk } from '../core/store'
import {
  disconnected,
  durationText,
  recorderWarnings,
  type RecorderConfig,
  type RecorderMedia,
  type RecorderSnapshot,
} from '../recorders/types'
import { Modal } from './Modal'

const stateLabels = {
  idle: 'Ready',
  recording: 'REC',
  paused: 'Paused',
  starting: 'Starting',
  finalizing: 'Finalizing',
  error: 'Record error',
  unknown: 'Unknown',
  offline: 'Offline',
  playback: 'Playback',
}
const bytes = (n: number) =>
  `${(n / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`
export function mediaSummary(media: RecorderMedia): string {
  return (
    [
      media.remainingSeconds !== undefined ? `${durationText(media.remainingSeconds)} left` : '',
      media.freeBytes !== undefined
        ? `${bytes(media.freeBytes)} free`
        : media.freePercent !== undefined
          ? `${media.freePercent}% free`
          : '',
    ]
      .filter(Boolean)
      .join(' · ') || media.status
  )
}
function RecorderCapsule({
  config,
  snapshot,
  readOnly,
  now,
  details,
}: {
  config: RecorderConfig
  snapshot: RecorderSnapshot
  readOnly: boolean
  now: number
  details: () => void
}) {
  const [confirm, setConfirm] = useState<{ until: number; recordingId?: string }>()
  const stale =
    !snapshot.updatedAt || now - snapshot.updatedAt > 10000 || snapshot.state === 'offline'
  const recording = snapshot.state === 'recording' || snapshot.state === 'paused'
  const disabled =
    readOnly ||
    stale ||
    !snapshot.enabled ||
    !snapshot.canControl ||
    !!snapshot.pending ||
    !['idle', 'recording', 'paused'].includes(snapshot.state)
  useEffect(() => {
    setConfirm(undefined)
  }, [snapshot.state, snapshot.recordingId, disabled])
  const confirming = confirm && confirm.until > now && confirm.recordingId === snapshot.recordingId
  const warnings = recorderWarnings(snapshot, config, now)
  const active = snapshot.media.find((m) => m.active) ?? snapshot.media[0]
  const extra = snapshot.media.filter((m) => m !== active)
  const state = snapshot.pending
    ? snapshot.pending === 'record'
      ? 'Starting…'
      : 'Stopping…'
    : stateLabels[snapshot.state]
  return (
    <article className="recorder-capsule" aria-label={`${config.label} recorder`}>
      <div className="recorder-line">
        <strong title={config.label}>{config.label}</strong>
        {config.simulated && <small className="recorder-demo">DEMO</small>}
        <span
          className={`recorder-state ${!stale && snapshot.state === 'recording' ? 'recording' : ''}`}
        >
          {state}
          {stale && snapshot.updatedAt ? ' · stale' : ''}
        </span>
        <span
          className="recorder-duration"
          title={
            snapshot.durationKind === 'observed'
              ? 'Estimated since recording was observed; frozen when stale'
              : 'Reported clip duration; may reset on segmentation'
          }
        >
          {snapshot.durationKind === 'observed' ? '~' : ''}
          {snapshot.duration ?? '—'}
        </span>
        <button
          className={`button recorder-transport ${confirming ? 'danger' : ''}`}
          disabled={disabled}
          title={
            disabled
              ? (snapshot.issue ??
                (readOnly ? 'Desk locked' : 'Enable control in Recorders after connecting'))
              : snapshot.scope
          }
          onClick={() => {
            if (recording && !confirming) {
              setConfirm({ until: Date.now() + 4000, recordingId: snapshot.recordingId })
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
          {snapshot.pending ? 'Wait' : confirming ? 'Confirm stop' : recording ? 'Stop' : 'Record'}
        </button>
        <button
          className="icon-button"
          aria-label={`${config.label} recorder details`}
          onClick={details}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <button
        className={`recorder-media-line ${warnings.length ? 'text-warning' : ''}`}
        onClick={details}
        title={warnings.join('\n') || 'View all media and details'}
      >
        {warnings.length
          ? `⚠ ${warnings[0]}`
          : active
            ? `${active.label}: ${mediaSummary(active)}`
            : 'Media not reported'}
        {extra.length > 0 && (
          <span>
            {extra[0].label} {extra[0].status}
            {extra.length > 1 ? ` · +${extra.length - 1}` : ''}
          </span>
        )}
      </button>
    </article>
  )
}
export function RecorderStrip({
  configs,
  readOnly,
  manage,
}: {
  configs: RecorderConfig[]
  readOnly: boolean
  manage: () => void
}) {
  const states = useSyncExternalStore(desk.recorders.subscribe, desk.recorders.getSnapshot)
  const [now, setNow] = useState(Date.now()),
    [detail, setDetail] = useState<string>()
  useEffect(() => {
    const tick = () => {
      setNow(Date.now())
      if (document.visibilityState === 'visible') void desk.recorders.tick()
    }
    const interval = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const config = configs.find((c) => c.id === detail)
  const snapshot = config ? (states[config.id] ?? disconnected()) : undefined
  const problems = configs.filter(
    (c) =>
      recorderWarnings(states[c.id] ?? disconnected(), c, now).length ||
      !states[c.id]?.updatedAt ||
      states[c.id]?.state === 'offline',
  ).length
  const recording = configs.filter(
    (c) => states[c.id]?.state === 'recording' && now - states[c.id].updatedAt <= 10000,
  ).length
  if (!configs.length) return null
  return (
    <>
      <section className="recorder-strip" aria-label="Recorder monitoring">
        <button className="recorder-overview" onClick={manage}>
          <strong>
            {recording} REC / {configs.length}
          </strong>
          <small className={problems ? 'text-warning' : ''}>
            {problems ? `${problems} need attention` : 'Recorders'}
          </small>
        </button>
        <div className="recorder-scroll" tabIndex={0} role="region" aria-label="Recorder list">
          {configs.map((c) => (
            <RecorderCapsule
              key={c.id}
              config={c}
              snapshot={states[c.id] ?? disconnected()}
              readOnly={readOnly}
              now={now}
              details={() => setDetail(c.id)}
            />
          ))}
        </div>
      </section>
      {config && snapshot && (
        <Modal
          title={config.label}
          subtitle={`${config.model} · ${snapshot.firmware ?? 'Firmware not reported'}${config.simulated ? ' · DEMO' : ''}`}
          close={() => setDetail(undefined)}
        >
          <p>{snapshot.scope}</p>
          <p className="muted">
            {snapshot.controlReason ?? 'Simulated recorder'} ·{' '}
            {snapshot.updatedAt
              ? `Last status ${new Date(snapshot.updatedAt).toLocaleTimeString()}`
              : 'Not connected'}
          </p>
          <p>
            {snapshot.durationKind === 'observed' ? 'Observed duration' : 'Clip duration'}:{' '}
            {snapshot.duration ?? 'Not reported'}
          </p>
          {recorderWarnings(snapshot, config, now).map((w) => (
            <p className="text-warning" key={w}>
              {w}
            </p>
          ))}
          <div className="recorder-media-details">
            {snapshot.media.length ? (
              snapshot.media.map((m) => (
                <section key={m.id}>
                  <strong>{m.label}</strong>
                  <span>{m.status}</span>
                  <p>
                    {mediaSummary(m)}
                    {m.totalBytes !== undefined ? ` / ${bytes(m.totalBytes)} total` : ''}
                  </p>
                  {m.metrics.map((v) => (
                    <p className="muted" key={v.label}>
                      {v.label}: {v.value}
                    </p>
                  ))}
                  <small className="muted">
                    {m.updatedAt
                      ? `Updated ${new Date(m.updatedAt).toLocaleTimeString()}`
                      : 'Not reported'}
                  </small>
                </section>
              ))
            ) : (
              <p className="muted">Media status, space and time remaining are not reported.</p>
            )}
          </div>
          <div className="modal-footer">
            {!config.simulated && (
              <a href={config.address} target="_blank" rel="noreferrer" className="button">
                Device web UI
              </a>
            )}
            <button
              className="button"
              onClick={() => {
                setDetail(undefined)
                manage()
              }}
            >
              Manage recorders
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
