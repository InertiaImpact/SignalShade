import { durationText, type RecorderMedia } from './types'
export function mediaSummary(media: RecorderMedia): string {
  if (/not inserted|empty|no media|not configured/i.test(media.status)) return media.status
  return (
    [
      media.remainingSeconds !== undefined ? `${durationText(media.remainingSeconds)} left` : '',
      media.freeBytes !== undefined
        ? `${(media.freeBytes / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB free`
        : media.freePercent !== undefined
          ? `${media.freePercent}% free`
          : '',
    ]
      .filter(Boolean)
      .join(' · ') || media.status
  )
}
