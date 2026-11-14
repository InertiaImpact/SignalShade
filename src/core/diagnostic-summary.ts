import { version } from '../../package.json'

type Row = Record<string, unknown>
type Capture = { reports: Record<string, unknown>; events: unknown[]; pending?: unknown[] }
const row = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {})
const text = (v: unknown) => (typeof v === 'string' ? v : '')
const models =
  /\b(?:FS\s*\|\s*HDR|FS-?HDR|FS1-X|FS[124]|HELO(?: Plus)?|Ki Pro(?: Ultra(?: Plus| 12G)?| Rack| Mini| GO2?)?)\b/i
const nativeIds = (value: string) => value.match(/\beParamID_[A-Za-z0-9_]{1,80}\b/g) ?? []
const shortId = (id: string) => id.replace('eParamID_', '')
const stepName =
  /^(?:Checking device access|Checking device web identity|Reading device descriptors|Identifying device|Reading FS-HDR operating mode|Reading FS-HDR input map|Checking color controls for VID[0-4]|Reading recorder status|Saving device connection)$/
function endpointName(path: string) {
  const id = nativeIds(path)[0]
  return (
    /^(desc\.json|map\.json|descriptors\?|device-info)/.exec(path)?.[0] ??
    (id ? shortId(id) : undefined)
  )?.slice(0, 60)
}

function reason(value: string) {
  if (/did not report an AJA FS model/i.test(value)) return 'model ID not reported'
  if (/multiple descriptors|conflicting descriptors|incompatible ranges/i.test(value))
    return 'duplicate descriptors'
  if (/update SignalShade Connect|unsupported AJA endpoint/i.test(value))
    return 'Connect update needed'
  if (
    /active input mapping missing|no descriptor|no readable.*memory|unsupported FS input map/i.test(
      value,
    )
  )
    return 'active input mapping missing'
  if (/invalid.*parameter map|FS-HDR parameter map/i.test(value)) return 'parameter map unavailable'
  if (/operating mode/i.test(value)) return 'operating mode unreadable/changed'
  if (/HTTP [1-5]\d\d\b/.test(value)) return value.match(/HTTP [1-5]\d\d\b/)![0]
  if (/exceeds.*MiB/i.test(value)) return 'response too large'
  if (/timeout|timed out|did not respond/i.test(value)) return 'timeout'
  if (/CORS|local.network|browser could not read/i.test(value)) return 'browser access blocked'
  if (/permission|approval|access required/i.test(value)) return 'approval needed'
  if (/authenticat|login/i.test(value)) return 'authentication failed'
  if (/not.*reach|failed to fetch/i.test(value)) return 'device unreachable'
  if (/out.of.range|readback mismatch|range for/i.test(value)) return 'readback/range mismatch'
  if (/no numeric|unrecognized response|different parameter/i.test(value))
    return 'invalid parameter readback'
  if (/source.*changed/i.test(value)) return 'input changed'
  return 'failed'
}

export function diagnosticSummary(
  capture: Capture,
  origin: string,
  extension?: string,
  modelHint?: string,
) {
  const report = row(capture.reports[origin]),
    identity = row(report.webIdentity)
  const scoped = capture.events.map(row).filter((e) => !!origin && e.origin === origin)
  const latest = scoped.reduce((start, e, i) => (e.action === 'device-attempt' ? i : start), 0)
  const events = scoped.slice(latest)
  const model = [report.model, identity.model, modelHint]
    .map(text)
    .join(' ')
    .match(models)?.[0]
    ?.replace(/\s*\|\s*/, '-')
  const firmware = text(report.firmware).match(/\b\d{1,2}\.\d{1,2}\.\d{1,2}(?:\.\d{1,2})?\b/)?.[0]
  const checks = Array.isArray(report.checks) ? report.checks.map(row) : []
  const failed = checks.filter((c) => c.status === 'fail')
  const mappingNote = checks.find((c) => text(c.detail).startsWith('Active input mapping missing'))
  const errorEvent = [...events].reverse().find((e) => e.action === 'connect-failed')
  const failure = failed[0] ?? (errorEvent ? row(errorEvent) : (mappingNote ?? {}))
  const failureText = text(failure.detail) || text(failure.error)
  const lastStage = text([...events].reverse().find((e) => e.action === 'add-stage')?.stage)
  const completed = events.some((e) => e.action === 'connect-complete')
  const cancelled = events.some((e) => e.action === 'connect-cancelled')
  const failureName = text(failure.name)
  const stage =
    /^(?:Readable API|Device identity|Ambiguous mapping|FS-HDR mapping|Operating mode|Color readback|Original FS1 interface|VID[0-4]|Processor [1-4])$/.test(
      failureName,
    )
      ? failureName
      : 'Connection'
  const failureIds = [...new Set(nativeIds(failureText).map(shortId))].slice(0, 2)
  const semantic = failureText.match(
    /\bmatch (procEnabled|rgbEnabled|gain|black|hue|saturation|(?:red|green|blue)(?:Gain|Black|Gamma))\b/,
  )?.[1]
  const mapping = failureText.match(
    /\binput index (\d{1,10}|unknown); (no entry|entry rejected|descriptor absent); (\d{1,5}) usable entries\b/,
  )
  const count = Number.isSafeInteger(report.rawDescriptorCount) ? report.rawDescriptorCount : '-'
  const mode = checks.some((c) => text(c.detail).includes('(VID0)'))
    ? '1ch'
    : checks.some((c) => text(c.detail).includes('(VID1-4)'))
      ? '4ch'
      : ''
  const lines = [
    `SignalShade ${version} | Connect ${/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(extension ?? '') ? extension : 'not detected'}`,
    `Device: ${model ?? 'unknown'}${firmware ? ' SW ' + firmware : ''}${mode ? ' ' + mode : ''}`,
    `Descriptors: ${count} | Processors: ${Array.isArray(report.channels) ? report.channels.length : '-'}`,
  ]
  if (stepName.test(lastStage) && (!completed || failureText)) lines.push(`Add step: ${lastStage}`)
  if (cancelled) lines.push('Connection cancelled')
  const pending = [...(capture.pending ?? [])]
    .reverse()
    .map(row)
    .find((e) => !!origin && e.origin === origin)
  const waiting = endpointName(text(pending?.path))
  if (!failureText && waiting) lines.push(`Waiting: ${waiting}`)
  if (failureText)
    lines.push(
      `${stage}: ${reason(failureText)}${semantic ? ' ' + semantic : ''}${failureIds.length ? ' ' + failureIds.join('/') : ''}`,
    )
  if (mapping) lines.push(`Input index: ${mapping[1]} | ${mapping[2]} | ${mapping[3]} map entries`)
  const selectedEvents = [
    ...events.filter((e) => /^(desc\.json|map\.json|descriptors\?)/.test(text(e.path))).slice(-2),
    ...events.filter((e) => e.error || (typeof e.status === 'number' && e.status >= 400)).slice(-3),
  ]
  for (const e of new Set(selectedEvents)) {
    const path = text(e.path)
    const endpoint = endpointName(path)
    if (!endpoint) continue
    const line = `${endpoint}: ${e.error ? reason(text(e.error)) : Number.isInteger(e.status) ? e.status : 'read'}`
    if (lines.join('\n').length + line.length < 410) lines.push(line)
  }
  if (!failureText && count === '-' && !events.length)
    lines.push('No device attempt recorded. Reproduce the issue first.')
  return lines.join('\n').slice(0, 450)
}

export const diagnosticFragment = '#diagnostic='
export function diagnosticLink(summary: string, base: string) {
  return base + diagnosticFragment + encodeURIComponent(summary)
}
