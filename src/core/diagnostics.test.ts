import { describe, it, expect } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import { debugZip, redactDiagnostics, diagnostics } from './diagnostics'
describe('combined diagnostics', () => {
  it('redacts credentials in fields, native parameters, and URLs while retaining useful readbacks', () => {
    const data = JSON.stringify(
      redactDiagnostics({
        password: 'secret-a',
        headers: { Authorization: 'secret-b', Cookie: 'secret-c' },
        descriptor: { param_id: 'eParamID_RecordingSharePasswordSMB', default_value: 'secret-d' },
        response: { name: 'eParamID_Password', value: 'secret-e' },
        address: 'http://user:secret-f@10.0.0.1/',
        control: { name: 'eParamID_ProcAmpHue', value: 12 },
      }),
    )
    for (const value of ['secret-a', 'secret-b', 'secret-c', 'secret-d', 'secret-e', 'secret-f'])
      expect(data).not.toContain(value)
    expect(data).toContain('eParamID_ProcAmpHue')
    expect(data).toContain('12')
  })
  it('produces a standard ZIP whose JSON and unicode filenames roundtrip with or without compression', async () => {
    const files = {
      'summary.json': JSON.stringify({ label: 'FS1 – Video 1' }),
      'connections.json': 'readback\n'.repeat(100),
      'notes.txt': '',
    }
    const bytes = await debugZip(files),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      decoded: Record<string, string> = {}
    let p = 0
    while (view.getUint32(p, true) === 0x04034b50) {
      const method = view.getUint16(p + 8, true),
        size = view.getUint32(p + 18, true),
        nameLength = view.getUint16(p + 26, true),
        extra = view.getUint16(p + 28, true)
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLength)),
        start = p + 30 + nameLength + extra,
        data = bytes.subarray(start, start + size)
      decoded[name] = new TextDecoder().decode(method === 8 ? inflateRawSync(data) : data)
      p = start + size
    }
    expect(decoded).toEqual(files)
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
  })
  it('retains probes and scan data independently of the settings panel', () => {
    diagnostics.report('test-device', { checks: [{ status: 'fail' }] })
    diagnostics.scan({ address: 'test-device', status: 'found' })
    diagnostics.event({ action: 'connect', error: 'HTTP 404' })
    const data = diagnostics.snapshot()
    expect(data.reports['test-device']).toEqual({ checks: [{ status: 'fail' }] })
    expect(data.scans).toContainEqual({ address: 'test-device', status: 'found' })
    expect(data.events).toContainEqual(expect.objectContaining({ error: 'HTTP 404' }))
  })
})
