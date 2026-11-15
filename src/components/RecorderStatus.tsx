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
export function recorderSummary(snapshot: RecorderSnapshot, now: number) {
  const stale = !!snapshot.updatedAt && now - snapshot.updatedAt > 10000
  const recording = !stale && snapshot.state === 'recording'
  const status = snapshot.pending
    ? snapshot.pending === 'record'
      ? 'Starting…'
      : 'Stopping…'
    : stale && snapshot.state !== 'offline'
      ? 'Stale'
      : recorderStateLabel[snapshot.state]
  const duration =
    !stale && (recording || snapshot.state === 'paused') && snapshot.duration
      ? `${snapshot.durationKind === 'observed' ? '~' : ''}${snapshot.duration}`
      : undefined
  return { stale, recording, status, duration }
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
        <span
          className="mono"
          title={
            snapshot.durationKind === 'observed'
              ? 'Elapsed since SignalShade first saw this recording'
              : 'Reported clip duration'
          }
        >
          {snapshot.durationKind === 'observed' ? '~' : ''}
          {snapshot.duration ?? '—'}
        </span>
      </div>
      {warnings.length > 0 && (
        <p className="text-warning">
          {warnings[0]}
          {warnings.length > 1 ? ` · ${warnings.length - 1} more` : ''}
        </p>
      )}
      <RecorderStorage media={snapshot.media} />
    </div>
  )
}

export function RecorderStorage({ media }: { media: RecorderSnapshot['media'] }) {
  if (!media.length) return <p className="muted">Storage status unavailable</p>
  return (
    <ul className="recorder-storage-list" aria-label="Storage destinations">
      {media.map((destination) => {
        const summary = mediaSummary(destination)
        return (
          <li
            key={destination.id}
            className={`recorder-storage-row ${destination.active ? 'active' : ''}`}
          >
            <strong>
              {destination.label}
              {destination.active && <small>Active</small>}
            </strong>
            <span>{destination.status === 'Unknown' ? 'Unavailable' : destination.status}</span>
            {summary !== destination.status && (
              <span className="recorder-storage-metrics">{summary}</span>
            )}
            {destination.freePercent !== undefined && (
              <meter
                min={0}
                max={100}
                value={destination.freePercent}
                aria-label={`${destination.label} free space`}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
