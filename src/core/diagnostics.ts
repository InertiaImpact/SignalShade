import type { Activity, Workspace } from './types'
import type { RecorderSnapshot } from '../recorders/types'
import { version as appVersion } from '../../package.json'

const sensitive = /password|passwd|authorization|cookie|credential|secret|token/i
export function redactDiagnostics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnostics)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const privateParameter = [object.param_id, object.name, object.label].some(
      (v) => typeof v === 'string' && sensitive.test(v),
    )
    return Object.fromEntries(
      Object.entries(object).map(([key, child]) => [
        key,
        sensitive.test(key) ||
        (privateParameter && /^(value|default_value|enum_values|response)$/.test(key))
          ? '[redacted]'
          : redactDiagnostics(child),
      ]),
    )
  }
  if (typeof value === 'string')
    return value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
  return value
}
class Diagnostics {
  private reports = new Map<string, unknown>()
  private scans: unknown[] = []
  private events: unknown[] = []
  report(address: string, report: unknown) {
    this.reports.set(address, redactDiagnostics(report))
    if (this.reports.size > 64) this.reports.delete(this.reports.keys().next().value!)
  }
  scan(result: unknown) {
    this.scans.push(redactDiagnostics(result))
    if (this.scans.length > 512) this.scans.shift()
  }
  event(event: Record<string, unknown>) {
    this.events.push(redactDiagnostics({ at: new Date().toISOString(), ...event }))
    if (this.events.length > 1000) this.events.shift()
  }
  snapshot() {
    return { reports: Object.fromEntries(this.reports), scans: this.scans, events: this.events }
  }
}
export const diagnostics = new Diagnostics()

const encoder = new TextEncoder()
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
export async function debugZip(files: Record<string, string>): Promise<Uint8Array> {
  const locals: Uint8Array[] = [],
    directory: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = encoder.encode(text),
      filename = encoder.encode(name)
    let packed = data,
      method = 0
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      packed = new Uint8Array(await new Response(stream).arrayBuffer())
      method = 8
    } catch {
      /* A valid uncompressed ZIP is available in older browsers. */
    }
    const crc = crc32(data),
      header = new Uint8Array(30),
      h = new DataView(header.buffer)
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, 0x800, true)
    h.setUint16(8, method, true)
    h.setUint16(12, 33, true)
    h.setUint32(14, crc, true)
    h.setUint32(18, packed.length, true)
    h.setUint32(22, data.length, true)
    h.setUint16(26, filename.length, true)
    locals.push(header, filename, packed)
    const central = new Uint8Array(46),
      c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x800, true)
    c.setUint16(10, method, true)
    c.setUint16(14, 33, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, packed.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, filename.length, true)
    c.setUint32(42, offset, true)
    directory.push(central, filename)
    offset += header.length + filename.length + packed.length
  }
  const size = directory.reduce((n, a) => n + a.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, Object.keys(files).length, true)
  e.setUint16(10, Object.keys(files).length, true)
  e.setUint32(12, size, true)
  e.setUint32(16, offset, true)
  const parts = [...locals, ...directory, end],
    result = new Uint8Array(offset + size + end.length)
  let cursor = 0
  for (const part of parts) {
    result.set(part, cursor)
    cursor += part.length
  }
  return result
}
export async function downloadDebugPackage(
  workspace: Workspace,
  activities: Activity[],
  recorders: Record<string, RecorderSnapshot>,
  extension?: string,
) {
  const json = (value: unknown) => JSON.stringify(redactDiagnostics(value), null, 2)
  const zip = await debugZip({
    'summary.json': json({
      generatedAt: new Date().toISOString(),
      origin: location.origin,
      browser: navigator.userAgent,
      extension,
      formatVersion: 1,
      appVersion,
    }),
    'workspace.json': json(workspace),
    'recorders.json': json(recorders),
    'activity.json': json(activities),
    'connections.json': json(diagnostics.snapshot()),
    'README.txt':
      'SignalShade debug package. Includes this session’s device probes, scans, recent request results, recorder state and workspace. Passwords, cookies and authorization headers are excluded. Device addresses and labels are included. No network commands were sent by exporting this package.\n',
  })
  const url = URL.createObjectURL(new Blob([new Uint8Array(zip)], { type: 'application/zip' })),
    a = document.createElement('a')
  a.href = url
  a.download = `signalshade-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
