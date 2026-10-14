import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Info,
  LoaderCircle,
  Network,
  Plus,
  Search,
  Server,
  Trash2,
  Unplug,
  RefreshCw,
  LockKeyhole,
} from 'lucide-react'
import { AjaAdapter, ipv4Range, message } from '../adapters/aja'
import { desk } from '../core/store'
import { downloadJson } from '../core/persistence'
import type { ProbeResult, Workspace } from '../core/types'
import { Modal } from './Modal'

export function DeviceDialog({
  workspace,
  close,
  readOnly,
}: {
  workspace: Workspace
  close: () => void
  readOnly: boolean
}) {
  const [address, setAddress] = useState(''),
    [label, setLabel] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState('')
  const [result, setResult] = useState<ProbeResult>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [scan, setScan] = useState(false),
    [end, setEnd] = useState(''),
    [progress, setProgress] = useState(''),
    [found, setFound] = useState<string[]>([]),
    [arm, setArm] = useState<string>()
  const adapter = useRef<AjaAdapter | undefined>(undefined),
    abort = useRef<AbortController | undefined>(undefined),
    kept = useRef(false)
  useEffect(
    () => () => {
      abort.current?.abort()
      if (!kept.current) adapter.current?.dispose()
    },
    [],
  )
  const probe = async (ip = address) => {
    setError('')
    setResult(undefined)
    setBusy(true)
    if (!kept.current) adapter.current?.dispose()
    kept.current = false
    abort.current?.abort()
    abort.current = new AbortController()
    try {
      let auth: string | undefined
      if (username || password)
        auth = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`
      const next = new AjaAdapter(ip, auth)
      adapter.current = next
      setResult(await next.probe(abort.current.signal))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const scanRange = async () => {
    setError('')
    setFound([])
    setResult(undefined)
    let ips: string[]
    try {
      ips = ipv4Range(address, end)
    } catch (e) {
      setError(message(e))
      return
    }
    setBusy(true)
    abort.current = new AbortController()
    const signal = abort.current.signal
    let cursor = 0,
      completed = 0
    await Promise.all(
      Array.from({ length: Math.min(4, ips.length) }, async () => {
        while (cursor < ips.length && !signal.aborted) {
          const ip = ips[cursor++],
            test = new AjaAdapter(ip)
          try {
            const json = await test.request('desc.json', signal)
            if (json && typeof json === 'object') setFound((previous) => [...previous, ip])
          } catch {
            /* candidates failing readable JSON are not devices */
          } finally {
            test.dispose()
            completed++
            setProgress(`${completed} / ${ips.length} addresses checked`)
          }
        }
      }),
    )
    setBusy(false)
  }
  return (
    <Modal
      title="Device connections"
      subtitle="Connect directly over your production LAN. Nothing is sent through GitHub."
      close={close}
      wide
    >
      <div className="device-dialog-grid">
        <div>
          <div className="section-heading">
            <span>YOUR FLEET</span>
            <span>{workspace.devices.length} devices</span>
          </div>
          <div className="device-list">
            {workspace.devices.map((d) => (
              <div className="device-row" key={d.id}>
                <div className={`device-symbol ${d.simulated ? 'demo' : ''}`}>
                  <Server size={18} />
                </div>
                <div className="grow">
                  <strong>{d.label}</strong>
                  <p>{d.simulated ? 'Simulated · no network traffic' : d.address}</p>
                  <small className={d.status === 'online' ? 'text-success' : 'text-warning'}>
                    {d.status} · {d.model} ·{' '}
                    {d.simulated ? 'Demo' : d.armed ? 'Writes enabled' : 'Read-only'}
                  </small>
                  {d.issue && <p className="text-error">{d.issue}</p>}
                </div>
                <div className="device-row-actions">
                  {!d.simulated && (
                    <>
                      <button
                        className="icon-button"
                        aria-label={`Reconnect ${d.label}`}
                        onClick={() => {
                          setAddress(d.address)
                          setLabel(d.label)
                          void probe(d.address)
                        }}
                        disabled={busy || readOnly}
                      >
                        <RefreshCw size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`${d.armed ? 'Lock' : 'Enable'} ${d.label} writes`}
                        disabled={readOnly || d.status !== 'online'}
                        onClick={() => {
                          if (d.armed) desk.armDevice(d.id, false)
                          else setArm(d.id)
                        }}
                      >
                        <LockKeyhole size={15} />
                      </button>
                    </>
                  )}
                  <button
                    className="icon-button"
                    aria-label={`Remove ${d.label}`}
                    disabled={readOnly || busy}
                    onClick={() => {
                      try {
                        desk.removeDevice(d.id)
                      } catch (e) {
                        setError(message(e))
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            {!workspace.devices.length && (
              <div className="empty-small">
                <Unplug size={24} />
                <p>Your fleet starts here.</p>
              </div>
            )}
          </div>
          {arm && (
            <div className="notice warning">
              <strong>Enable live writes?</strong>
              <p>
                Changes will affect this device immediately. Descriptor mappings use native units
                and require an off-air write/readback test before production use. Verify the
                controls against the AJA interface.
              </p>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => {
                    try {
                      desk.armDevice(arm, true)
                      setArm(undefined)
                    } catch (e) {
                      setError(message(e))
                    }
                  }}
                >
                  Enable live writes
                </button>
                <button className="button" onClick={() => setArm(undefined)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="notice">
            <Info size={17} />
            <div>
              <strong>Browser compatibility comes first</strong>
              <p>
                Allow local network access when your browser asks. Devices must also support
                cross-origin API access. A readable device page alone does not prove the dashboard
                can connect. Start with desktop Chrome.
              </p>
            </div>
          </div>
        </div>
        <div>
          <div className="tabs">
            <button
              className={!scan ? 'active' : ''}
              disabled={busy}
              onClick={() => setScan(false)}
            >
              <Plus size={14} /> Add by IP
            </button>
            <button className={scan ? 'active' : ''} disabled={busy} onClick={() => setScan(true)}>
              <Search size={14} /> Find devices
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void (scan ? scanRange() : probe())
            }}
          >
            <label className="field">
              {scan ? 'Start address' : 'Device address'}
              <input
                required
                placeholder="192.168.1.20"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={busy || readOnly}
              />
            </label>
            {scan ? (
              <>
                <label className="field">
                  End address
                  <input
                    required
                    placeholder="192.168.1.40"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    disabled={busy || readOnly}
                  />
                </label>
                <p className="muted">
                  Read-only scan of one specified /24 subnet. Up to four probes at once. Found
                  addresses still require full identification.
                </p>
              </>
            ) : (
              <>
                <label className="field">
                  Device label
                  <input
                    maxLength={100}
                    placeholder="FS1 (automatic when left blank)"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    disabled={busy || readOnly}
                  />
                </label>
                <details className="auth">
                  <summary>Device authentication (optional)</summary>
                  <label className="field">
                    Username
                    <input
                      autoComplete="off"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Password
                    <input
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    Session only. Basic authentication requires device CORS support for
                    Authorization. HTTP does not encrypt LAN credentials.
                  </p>
                </details>
              </>
            )}
            <div className="button-row">
              <button className="button primary" disabled={busy || readOnly} type="submit">
                {busy ? <LoaderCircle size={16} className="spin" /> : <Network size={16} />}
                {scan ? 'Scan range' : 'Test connection'}
              </button>
              {busy && (
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    abort.current?.abort()
                    if (!kept.current) adapter.current?.dispose()
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          {progress && scan && <p className="muted">{progress}</p>}
          {scan &&
            found.map((ip) => (
              <div className="found-device" key={ip}>
                <span>{ip}</span>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => {
                    setAddress(ip)
                    setScan(false)
                    void probe(ip)
                  }}
                >
                  Inspect device
                </button>
              </div>
            ))}
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="probe-results">
              {result.checks.map((c, i) => (
                <div className={`probe-check ${c.status}`} key={i}>
                  {c.status === 'pass' ? (
                    <CheckCircle2 size={17} />
                  ) : c.status === 'fail' ? (
                    <CircleAlert size={17} />
                  ) : (
                    <Info size={17} />
                  )}
                  <div>
                    <strong>{c.name}</strong>
                    <p>{c.detail}</p>
                  </div>
                </div>
              ))}
              {!!result.descriptors.length && (
                <details className="mapping-review">
                  <summary>Review {result.descriptors.length} mapped color parameters</summary>
                  {result.channels.map((c) => (
                    <div key={c.id}>
                      <strong>Processor {c.processor}</strong>
                      {c.descriptors.map((d) => (
                        <p key={d.id}>
                          <code>{d.nativeId}</code>
                          <br />
                          {d.label} · {d.min}–{d.max} · step {d.step} · default {d.neutral} {d.unit}
                        </p>
                      ))}
                    </div>
                  ))}
                </details>
              )}
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    readOnly ||
                    !result.model ||
                    !result.channels.length ||
                    result.checks.some((c) => c.status === 'fail')
                  }
                  onClick={() => {
                    try {
                      desk.connect(adapter.current!, result, label)
                      kept.current = true
                      setResult(undefined)
                      setPassword('')
                      setError('')
                    } catch (e) {
                      setError(message(e))
                    }
                  }}
                >
                  Add / reconnect device
                </button>
                <button
                  className="button"
                  onClick={() =>
                    downloadJson('signalshade-connection-report.json', {
                      ...result,
                      testedAt: new Date().toISOString(),
                      origin: location.origin,
                      browser: navigator.userAgent,
                    })
                  }
                >
                  Export report
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
