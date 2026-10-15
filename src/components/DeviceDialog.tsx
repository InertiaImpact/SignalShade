import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, Search, Server, Trash2 } from 'lucide-react'
import { AjaAdapter, ipv4Range, message, normalizeAddress } from '../adapters/aja'
import { bridgeMessage, detectConnect, ensureDeviceAccess } from '../adapters/transport'
import { scanDevices, type DiscoveryResult } from '../adapters/discovery'
import { desk } from '../core/store'
import { downloadJson } from '../core/persistence'
import type { ProbeResult, Workspace } from '../core/types'
import { Modal } from './Modal'
import { ConnectHelp } from './ConnectHelp'

export function DeviceDialog({
  workspace,
  close,
  readOnly,
  recorders,
}: {
  workspace: Workspace
  close: () => void
  readOnly: boolean
  recorders: () => void
}) {
  const [address, setAddress] = useState(''),
    [label, setLabel] = useState('')
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('')
  const [start, setStart] = useState(''),
    [end, setEnd] = useState('')
  const [busy, setBusy] = useState<string>(),
    [scanState, setScanState] = useState('Not started')
  const [results, setResults] = useState<Record<string, DiscoveryResult>>({})
  const [reports, setReports] = useState<Record<string, ProbeResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState(''),
    [scanError, setScanError] = useState(''),
    [arm, setArm] = useState<string>()
  const abort = useRef<AbortController | undefined>(undefined),
    activeAdapters = useRef(new Set<AjaAdapter>())
  const scanRange = useRef<{ start: string; end: string } | undefined>(undefined)
  const mounted = useRef(true)
  const cancel = () => {
    abort.current?.abort()
    window.dispatchEvent(new CustomEvent('signalshade-approval-cancel'))
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abort.current?.abort()
      activeAdapters.current.forEach((a) => a.dispose())
    }
  }, [])
  const exportReport = (report: ProbeResult) =>
    downloadJson('signalshade-connection-report.json', {
      ...report,
      testedAt: new Date().toISOString(),
      origin: location.origin,
      browser: navigator.userAgent,
    })
  const addDevice = async (ip: string, name = '', fromScan = false) => {
    let origin: string
    try {
      origin = normalizeAddress(ip)
    } catch (e) {
      setNotice(message(e))
      return
    }
    setBusy(origin)
    setNotice('')
    setErrors((previous) => ({ ...previous, [origin]: '' }))
    const controller = new AbortController()
    abort.current = controller
    let adapter: AjaAdapter | undefined,
      kept = false
    try {
      if (fromScan) {
        const status = (await bridgeMessage('scan-status', { start: origin, end: origin })) as {
          allowed: boolean
        }
        if (!status.allowed) await ensureDeviceAccess(origin)
      } else await ensureDeviceAccess(origin)
      if (controller.signal.aborted) return
      let auth: string | undefined
      if (username || password)
        auth = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`
      adapter = new AjaAdapter(origin, auth)
      activeAdapters.current.add(adapter)
      const report = await adapter.probe(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setReports((previous) => ({ ...previous, [origin]: report }))
      if (
        !report.model ||
        !report.channels.length ||
        report.checks.some((c) => c.status === 'fail')
      ) {
        setErrors((previous) => ({
          ...previous,
          [origin]: report.checks
            .filter((c) => c.status === 'fail')
            .map((c) => c.detail)
            .join(' '),
        }))
        return
      }
      if (fromScan && (await detectConnect())) await bridgeMessage('adopt', { origin })
      if (controller.signal.aborted) return
      desk.connect(adapter, report, name)
      kept = true
      setNotice(`${name || report.model} added · ${origin}`)
      setPassword('')
    } catch (e) {
      if (mounted.current && !controller.signal.aborted)
        setErrors((previous) => ({ ...previous, [origin]: message(e) }))
    } finally {
      if (adapter) {
        activeAdapters.current.delete(adapter)
        if (!kept) adapter.dispose()
      }
      if (mounted.current) setBusy(undefined)
    }
  }
  const runScan = async () => {
    let ips: string[]
    try {
      ips = ipv4Range(start, end)
    } catch (e) {
      setScanError(message(e))
      return
    }
    const range = { start: normalizeAddress(ips[0]), end: normalizeAddress(ips.at(-1)!) }
    const controller = new AbortController()
    abort.current = controller
    setBusy('scan')
    setScanError('')
    setScanState('Waiting for scan access…')
    try {
      await ensureDeviceAccess(range.start, range)
      if (controller.signal.aborted) return
      scanRange.current = range
      setScanState(`0 / ${ips.length} checked`)
      await scanDevices(
        ips,
        controller.signal,
        (result) => setResults((previous) => ({ ...previous, [result.address]: result })),
        (completed) => setScanState(`${completed} / ${ips.length} checked`),
      )
      if (mounted.current)
        setScanState(
          (previous) => `${previous} · ${controller.signal.aborted ? 'Stopped' : 'Complete'}`,
        )
    } catch (e) {
      if (mounted.current) {
        if (!controller.signal.aborted) setScanError(message(e))
        setScanState('Not completed')
      }
    } finally {
      if (mounted.current) setBusy(undefined)
    }
  }
  const reportDetails = (origin: string) => {
    const report = reports[origin]
    if (!report) return null
    return (
      <details className="connection-report">
        <summary>Connection details · {origin}</summary>
        {report.checks.map((c, i) => (
          <p key={i} className={c.status === 'fail' ? 'text-error' : 'muted'}>
            <strong>{c.name}:</strong> {c.detail}
          </p>
        ))}
        <button className="button small" onClick={() => exportReport(report)}>
          <Download size={14} />
          Export report
        </button>
      </details>
    )
  }
  const sorted = Object.values(results).sort(
    (a, b) =>
      Number(new URL(a.address).hostname.split('.').at(-1)) -
      Number(new URL(b.address).hostname.split('.').at(-1)),
  )
  const visible = sorted.filter((r) => r.status === 'found')
  const unidentified = sorted.filter((r) => r.status !== 'found' && r.status !== 'unreachable')
  const unreachable = sorted.filter((r) => r.status === 'unreachable')
  const currentOrigin = (() => {
    try {
      return normalizeAddress(address)
    } catch {
      return ''
    }
  })()
  return (
    <Modal
      title="Devices"
      subtitle="Add by IP or scan your network. Added devices stay listed here."
      close={close}
      wide
    >
      <div className="devices-toolbar">
        <span>{workspace.devices.length} added</span>
        <button className="button small" onClick={recorders}>
          Manage recorders
        </button>
      </div>
      <section className="device-section" aria-label="Added devices">
        <h3>Added devices</h3>
        {!workspace.devices.length && <p className="muted">No devices added yet.</p>}
        {workspace.devices.map((d) => (
          <div key={d.id} className="device-row">
            <Server size={18} />
            <div className="grow">
              <strong>
                {d.label} {d.simulated && <span className="device-demo-badge">DEMO</span>}
              </strong>
              <p>
                {d.model} · {d.simulated ? 'Simulated' : d.address}
              </p>
              <small>
                {d.status} · {d.armed ? 'Control enabled' : 'Read-only'}
              </small>
              {d.issue && <p className="text-error">{d.issue}</p>}
              {errors[d.address] && <p className="text-error">{errors[d.address]}</p>}
              {reportDetails(d.address)}
            </div>
            <div className="device-row-actions">
              {!d.simulated && (
                <>
                  <button
                    className="button small"
                    disabled={!!busy || readOnly}
                    onClick={() => void addDevice(d.address, d.label)}
                  >
                    <RefreshCw size={14} />
                    Reconnect
                  </button>
                  <button
                    className="button small"
                    disabled={!!busy || readOnly || d.status !== 'online'}
                    onClick={() => (d.armed ? desk.armDevice(d.id, false) : setArm(d.id))}
                  >
                    {d.armed ? 'Lock control' : 'Enable control'}
                  </button>
                </>
              )}
              <button
                className="icon-button"
                aria-label={`Remove ${d.label}`}
                disabled={!!busy || readOnly}
                onClick={() => {
                  try {
                    desk.removeDevice(d.id)
                  } catch (e) {
                    setNotice(message(e))
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {arm && (
          <div className="notice warning">
            <p>
              Enable live adjustments for {workspace.devices.find((d) => d.id === arm)?.label}?
              Verify mappings off-air before production use.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                onClick={() => {
                  try {
                    desk.armDevice(arm, true)
                    setArm(undefined)
                  } catch (e) {
                    setNotice(message(e))
                  }
                }}
              >
                Enable control
              </button>
              <button className="button" onClick={() => setArm(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
      <ConnectHelp />
      <section className="device-section" aria-label="Add by IP">
        <h3>Add by IP</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void addDevice(address, label)
          }}
        >
          <div className="form-inline">
            <label className="field grow">
              IP address
              <input
                required
                placeholder="10.215.20.225"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => {
                  if (!start) {
                    try {
                      const prefix = new URL(normalizeAddress(address)).hostname
                        .split('.')
                        .slice(0, 3)
                        .join('.')
                      setStart(`${prefix}.1`)
                      setEnd(`${prefix}.254`)
                    } catch {
                      /* Wait for a valid device address. */
                    }
                  }
                }}
                disabled={!!busy || readOnly}
              />
            </label>
            <label className="field grow">
              Label (optional)
              <input
                maxLength={100}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="FS name"
                disabled={!!busy || readOnly}
              />
            </label>
            <button className="button primary" disabled={!!busy || readOnly}>
              {busy === currentOrigin ? 'Adding…' : 'Add device'}
            </button>
          </div>
          <details className="auth">
            <summary>Authentication (optional · used for add and scan results)</summary>
            <div className="form-inline">
              <label className="field grow">
                Username
                <input
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={!!busy}
                />
              </label>
              <label className="field grow">
                Password
                <input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!!busy}
                />
              </label>
            </div>
          </details>
        </form>
        {errors[currentOrigin] && (
          <p className="text-error" role="alert">
            {errors[currentOrigin]}
          </p>
        )}
        {reportDetails(currentOrigin)}
      </section>
      <section className="device-section" aria-label="Scan network">
        <h3>Scan network</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void runScan()
          }}
        >
          <div className="form-inline">
            <label className="field grow">
              Start address
              <input
                required
                placeholder="10.215.20.1"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                disabled={!!busy || readOnly}
              />
            </label>
            <label className="field grow">
              End address
              <input
                required
                placeholder="10.215.20.254"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={!!busy || readOnly}
              />
            </label>
            <button className="button primary" disabled={!!busy || readOnly}>
              <Search size={14} />
              {busy === 'scan' ? 'Scanning…' : 'Scan network'}
            </button>
          </div>
        </form>
        <p className="muted">
          Read-only scan · one range approval · network and broadcast addresses are skipped.
        </p>
        <p role="status">
          {scanState} · {visible.length} AJA devices · {unidentified.length} not identified as AJA ·{' '}
          {unreachable.length} unreachable
        </p>
        {scanError && (
          <p className="text-error" role="alert">
            {scanError}
          </p>
        )}
        <div className="scan-results">
          {visible.map((r) => {
            const added = workspace.devices.some((d) => d.address === r.address && !d.simulated)
            return (
              <div className="scan-result" key={r.address}>
                <div className="grow">
                  <strong>{r.model || r.title || 'HTTP device'}</strong>
                  <p>
                    {r.address} · {r.detail}
                  </p>
                  {errors[r.address] && <p className="text-error">{errors[r.address]}</p>}
                  {reportDetails(r.address)}
                </div>
                <button
                  className="button small"
                  disabled={added || !!busy || readOnly}
                  onClick={() => void addDevice(r.address, '', true)}
                >
                  {added ? 'Added' : busy === r.address ? 'Adding…' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>
        {!!unreachable.length && (
          <details>
            <summary>Unreachable addresses ({unreachable.length})</summary>
            {unreachable.map((r) => (
              <p className="muted" key={r.address}>
                {r.address} · {r.detail}
              </p>
            ))}
          </details>
        )}
        {!!sorted.length && (
          <button
            className="button small"
            onClick={() =>
              downloadJson('signalshade-scan-report.json', {
                range: scanRange.current,
                results: sorted,
                reports,
                testedAt: new Date().toISOString(),
              })
            }
          >
            Export scan report
          </button>
        )}
      </section>
      {notice && <p role="status">{notice}</p>}
      {busy && (
        <button className="button" onClick={cancel}>
          {busy === 'scan' ? 'Stop scan' : 'Cancel connection'}
        </button>
      )}
    </Modal>
  )
}
