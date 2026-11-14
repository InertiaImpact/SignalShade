import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  disconnected,
  recorderWarnings,
  type RecorderConfig,
  type RecorderSnapshot,
} from '../recorders/types'
import { Modal } from './Modal'
import { RecorderStorage, recorderSummary } from './RecorderStatus'
import { RecorderTransport } from './RecorderTransport'

export function RecorderOverview({
  configs,
  states,
  readOnly,
  openDevice,
  close,
}: {
  configs: RecorderConfig[]
  states: Readonly<Record<string, RecorderSnapshot>>
  readOnly: boolean
  openDevice: (id: string) => void
  close: () => void
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <Modal title="Recorder overview" close={close} wide className="recorder-fleet-modal">
      <div className="recorder-fleet">
        {configs.map((config) => {
          const snapshot = states[config.id] ?? disconnected()
          const { status, recording, duration, stale } = recorderSummary(snapshot, now)
          const warnings = recorderWarnings({ ...snapshot, issue: undefined }, config, now)
          const warning = snapshot.issue ? 'Connection needs attention' : warnings[0]
          return (
            <article
              key={config.id}
              className="recorder-fleet-card"
              aria-label={`${config.label} recorder`}
            >
              <div className="recorder-fleet-heading">
                <h3>{config.label}</h3>
                {config.simulated && <span className="device-demo-badge">DEMO</span>}
              </div>
              <div className="recorder-fleet-state">
                <strong className={recording ? 'text-recording' : ''}>{status}</strong>
                {duration && <span className="mono">{duration}</span>}
              </div>
              {warning && <p className="text-warning recorder-fleet-warning">{warning}</p>}
              <RecorderStorage
                media={stale || snapshot.state === 'offline' ? [] : snapshot.media}
              />
              <div className="recorder-fleet-actions">
                <RecorderTransport
                  config={config}
                  snapshot={snapshot}
                  readOnly={readOnly}
                  now={now}
                />
                <button
                  className="button"
                  aria-label={`Open ${config.label} device settings`}
                  onClick={() => openDevice(config.id)}
                >
                  Device settings <ChevronRight size={14} />
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </Modal>
  )
}
