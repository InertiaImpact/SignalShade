import { mediaSummary } from '../recorders/display'
import { recorderWarnings, type RecorderConfig, type RecorderSnapshot } from '../recorders/types'
export const recorderStateLabel: Record<RecorderSnapshot['state'], string> = {
  idle: 'Ready',
  recording: 'REC',
  paused: 'Paused',
  starting: 'Starting',
  finalizing: 'Finalizing',
  error: 'Record error',
  unknown: 'Connecting',
  offline: 'Offline',
  playback: 'Playback',
}
export function RecorderStatus({
  config,
  snapshot,
}: {
  config: RecorderConfig
  snapshot: RecorderSnapshot
}) {
  const warnings = recorderWarnings({ ...snapshot, issue: undefined }, config)
  return (
    <div className="recorder-status-summary">
      <div className="recorder-status-top">
        <strong className={snapshot.state === 'recording' ? 'text-recording' : ''}>
          {recorderStateLabel[snapshot.state]}
        </strong>
        <span className="mono">{snapshot.duration ?? '—'}</span>
      </div>
      {warnings.length > 0 && (
        <p className="text-warning">
          {warnings[0]}
          {warnings.length > 1 ? ` · ${warnings.length - 1} more` : ''}
        </p>
      )}
      <div className="recorder-storage-list">
        {snapshot.media.map((media) => (
          <div key={media.id} className={`recorder-storage-row ${media.active ? 'active' : ''}`}>
            <strong>{media.label}</strong>
            <span>{media.status === 'Unknown' ? 'Unavailable' : media.status}</span>
            <span>{mediaSummary(media) === media.status ? '' : mediaSummary(media)}</span>
            {media.freePercent !== undefined && (
              <meter
                min={0}
                max={100}
                value={media.freePercent}
                aria-label={`${media.label} free space`}
              />
            )}
          </div>
        ))}
      </div>
      {!snapshot.media.length && <p className="muted">Storage status unavailable</p>}
    </div>
  )
}
