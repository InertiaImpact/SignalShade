import type { RecorderMedia } from './types'
type Raw = Record<string, unknown>
export function isMediaDescriptor(d: Raw) {
  const id = String(d.param_id),
    label = String(d.param_name ?? '')
  if (/password|credential|path|url|clip|alarm|insecure|manager|debounced/i.test(id + ' ' + label))
    return false
  return (
    /^eParamID_(?:MediaState|RecordingDestination|SecondaryRecordingDestination|(?:Current|Secondary)Media(?:Mounted|Available|UnusedBytes|TotalBytes))$/.test(
      id,
    ) ||
    /^eParamID_SL_(?:SD|USB|SMB|NFS)_(?:Status|FreeSpace|TotalSpace)$/.test(id) ||
    (/media|disk|\bsd\b|\busb\b|\bslot\b|\bpak\b/i.test(label) &&
      /(?:available|free|remaining|capacity|total|status|mounted|present)(?:\s*\d+)?$/i.test(
        label,
      ) &&
      !/command|format|state/i.test(label))
  )
}
const finite = (v: unknown) =>
  v !== null &&
  v !== undefined &&
  String(v).trim() !== '' &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : undefined
export function mediaMetric(d: Raw, response: Raw, now: number): RecorderMedia {
  const label = String(d.param_name ?? d.param_id),
    id = String(d.param_id),
    n = finite(response.value)
  const choice = Array.isArray(d.enum_values)
    ? d.enum_values.find((v) => String(v.value) === String(response.value))
    : undefined
  const text = String(response.value_name ?? choice?.text ?? response.value ?? '').trim(),
    units = String(d.units ?? '').trim()
  const m: RecorderMedia = {
    id,
    label,
    status: 'Unknown',
    active: /^eParamID_CurrentMedia/.test(id) || /^current media/i.test(label),
    updatedAt: now,
    metrics: text ? [{ label, value: `${text}${units ? ' ' + units : ''}` }] : [],
    warnings: [],
  }
  const scale = d.scale_by === undefined ? 1 : Number(d.scale_by),
    offset = d.offset_by === undefined ? 0 : Number(d.offset_by)
  if (n !== undefined && scale === 1 && offset === 0) {
    const free = /available|free|remaining|unused/i.test(label + ' ' + id)
    const bytes = (
      {
        bytes: 1,
        B: 1,
        KB: 1e3,
        MB: 1e6,
        GB: 1e9,
        TB: 1e12,
        KiB: 1024,
        MiB: 1024 ** 2,
        GiB: 1024 ** 3,
      } as Record<string, number>
    )[units]
    if (free && bytes) m.freeBytes = n * bytes
    if (/total|capacity/i.test(label) && bytes) m.totalBytes = n * bytes
    if (/(?:Current|Secondary)MediaUnusedBytes$/.test(id)) m.freeBytes = n
    if (/(?:Current|Secondary)MediaTotalBytes$/.test(id)) m.totalBytes = n
    if (
      free &&
      (units === '%' || /^eParamID_(?:Current|Secondary)MediaAvailable$/.test(id)) &&
      n <= 100
    )
      m.freePercent = n
    const seconds = ({ s: 1, sec: 1, seconds: 1, min: 60, minutes: 60 } as Record<string, number>)[
      units
    ]
    if (free && /time|duration/i.test(label) && seconds) m.remainingSeconds = n * seconds
  }
  if (/status|state/i.test(label))
    m.status = /^empty$/i.test(text) ? 'Not inserted' : text || 'Unknown'
  if (/mounted|present/i.test(label))
    m.status = /^(true|yes|1)$/i.test(text)
      ? 'Ready'
      : /^(false|no|0)$/i.test(text)
        ? 'No media'
        : text || 'Unknown'
  if (/\b(full|error|failed|read.only)\b/i.test(m.status)) m.warnings.push(m.status)
  return m
}
export function groupMedia(fields: RecorderMedia[]): RecorderMedia[] {
  const groups = new Map<string, RecorderMedia>()
  for (const field of fields) {
    if (/^(eParamID_MediaState|eParamID_(?:Secondary)?RecordingDestination)$/.test(field.id))
      continue
    const main = /^eParamID_CurrentMedia|^current media/i.test(field.id + ' ' + field.label)
    const backup = /^eParamID_SecondaryMedia/.test(field.id)
    const slot = field.label.match(
      /\b(?:SD(?: card)?|USB(?:\s*\d+)?|PAK\s*\d+|slot\s*[A-Z0-9]+|disk\s*\d+|SMB|NFS|network)\b/i,
    )?.[0]
    const id = main
      ? 'main'
      : backup
        ? 'backup'
        : (slot?.toUpperCase().replace(/\s+/g, ' ') ?? field.id)
    const label = main ? 'Main' : backup ? 'Backup' : (slot ?? field.label),
      old = groups.get(id)
    if (!old) groups.set(id, { ...field, id, label, active: main || field.active })
    else
      groups.set(id, {
        ...old,
        ...Object.fromEntries(
          Object.entries(field).filter(
            ([k, v]) =>
              v !== undefined &&
              ['freeBytes', 'totalBytes', 'freePercent', 'remainingSeconds'].includes(k),
          ),
        ),
        status: field.status === 'Unknown' ? old.status : field.status,
        active: old.active || field.active,
        updatedAt: Math.max(old.updatedAt, field.updatedAt),
        metrics: [...old.metrics, ...field.metrics],
        warnings: [...new Set([...old.warnings, ...field.warnings])],
      })
  }
  for (const [id, destinationId] of [
    ['main', 'eParamID_RecordingDestination'],
    ['backup', 'eParamID_SecondaryRecordingDestination'],
  ]) {
    const destination = fields.find((f) => f.id === destinationId)?.metrics[0]?.value
    const group = groups.get(id)
    if (group && destination) {
      group.label = `${id === 'main' ? 'Main' : 'Backup'} · ${destination.replace(/[_-]/g, ' ')}`
      if (/none|disabled|off|no recording/i.test(destination)) {
        group.status = 'Not configured'
        group.warnings = []
      }
    }
  }
  return [...groups.values()]
}
