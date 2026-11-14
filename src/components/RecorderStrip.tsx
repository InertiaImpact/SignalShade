import { useEffect, useState, useSyncExternalStore } from 'react'
import { TriangleAlert } from 'lucide-react'
import { desk } from '../core/store'
import { disconnected, recorderWarnings, type RecorderConfig } from '../recorders/types'
import { recorderStateLabel } from './RecorderStatus'
import { RecorderTransport } from './RecorderTransport'

export function RecorderStrip({
  configs,
  readOnly,
  manage,
}: {
  configs: RecorderConfig[]
  readOnly: boolean
  manage: (id?: string) => void
}) {
  const states = useSyncExternalStore(desk.recorders.subscribe, desk.recorders.getSnapshot)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!configs.length) return
    const tick = () => {
      setNow(Date.now())
      if (document.visibilityState === 'visible') void desk.recorders.tick()
    }
    const timer = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [configs.length])
  if (!configs.length) return null

  const recorders = configs.map((config) => {
    const snapshot = states[config.id] ?? disconnected()
    const stale = !!snapshot.updatedAt && now - snapshot.updatedAt > 10000
    const recording = !stale && snapshot.state === 'recording'
    const warnings = recorderWarnings(snapshot, config, now)
    const attention = warnings.length > 0 || snapshot.state === 'offline'
    const status = snapshot.pending
      ? snapshot.pending === 'record'
        ? 'Starting…'
        : 'Stopping…'
      : stale
        ? 'Stale'
        : recorderStateLabel[snapshot.state]
    const duration =
      !stale && (recording || snapshot.state === 'paused') && snapshot.duration
        ? `${snapshot.durationKind === 'observed' ? '~' : ''}${snapshot.duration}`
        : undefined
    return { config, snapshot, recording, warnings, attention, status, duration }
  })
  const single = recorders.length === 1 ? recorders[0] : undefined
  const active = recorders.filter((item) => item.recording)
  const attention = recorders.filter((item) => item.attention)
  const first = active[0] ?? attention[0] ?? recorders[0]
  const overview = single
    ? [single.status, single.duration].filter(Boolean).join(' ')
    : `${active.length} REC / ${recorders.length}`
  const overviewTitle = single
    ? `${single.config.label} · ${overview}`
    : `${active.length} recording · ${recorders.length} recorders`
  return (
    <section className="recorder-strip" aria-label="Recorder monitoring">
      <button
        className={`recorder-overview ${single ? 'single' : ''} ${active.length ? 'recording' : ''}`}
        aria-label={`Recorder details · ${overviewTitle}${attention.length ? ` · ${attention.length} need attention` : ''}`}
        title={`${overviewTitle}${attention.length ? ` · ${attention.length} need attention` : ''}`}
        onClick={() => manage(first.config.id)}
      >
        {overview}
        {attention.length > 0 && <TriangleAlert size={11} className="text-warning" />}
      </button>
      <div className="recorder-scroll" role="group" aria-label="Recorder list">
        {recorders.map(({ config, snapshot, recording, warnings, attention, status, duration }) => (
          <article
            className="recorder-capsule"
            key={config.id}
            aria-label={`${config.label} recorder`}
          >
            <button
              className="recorder-glance"
              aria-label={`${config.label} recorder details`}
              title={[config.label, status, ...warnings].join('\n')}
              onClick={() => manage(config.id)}
            >
              <span className="recorder-glance-label">
                <strong>{config.label}</strong>
                {config.simulated && <small>DEMO</small>}
                {attention && <TriangleAlert size={10} className="text-warning" />}
              </span>
              <span className={`recorder-state ${recording ? 'recording' : ''}`}>
                {status}
                {duration && (
                  <span
                    className="recorder-duration"
                    title={
                      snapshot.durationKind === 'observed'
                        ? 'Estimated recording duration'
                        : 'Reported clip duration'
                    }
                  >
                    {duration}
                  </span>
                )}
              </span>
            </button>
            <RecorderTransport
              config={config}
              snapshot={snapshot}
              readOnly={readOnly}
              now={now}
              compact
            />
          </article>
        ))}
      </div>
    </section>
  )
}
