import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Download, Plus, Search, Server, Circle, QrCode } from 'lucide-react'
import { AjaAdapter, ipv4Range, message, normalizeAddress } from '../adapters/aja'
import { bridgeMessage, detectConnect, ensureDeviceAccess } from '../adapters/transport'
import { scanDevices, type DiscoveryResult } from '../adapters/discovery'
import { desk } from '../core/store'
import { diagnostics, downloadDebugPackage } from '../core/diagnostics'
import { diagnosticSummary } from '../core/diagnostic-summary'
import type { Model, Workspace } from '../core/types'
import {
  recorderModels,
  detectRecorderModel,
  type RecorderModel,
  type RecorderConfig,
} from '../recorders/types'
import { demoRecorder } from '../recorders/demo'
import { Modal } from './Modal'
import { ConnectHelp } from './ConnectHelp'
import { DeviceDetails } from './DeviceDetails'
import { DiagnosticQr } from './DiagnosticQr'
import { recorderStateLabel } from './RecorderStatus'

const fsModels: Model[] = ['FS4', 'FS2', 'FS1-X', 'FS1', 'FS-HDR']
type DeviceType = Model | RecorderModel | 'auto'
const isRecorder = (type: DeviceType): type is RecorderModel =>
  recorderModels.includes(type as RecorderModel)
const addTimeout = 75_000
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([work, cancelled])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
function conciseError(text: string) {
  if (/CORS|Browser could not read|local.network restrictions/i.test(text))
    return 'Browser access blocked. Check Connect and device access.'
  if (/timed out|did not respond|could not reach/i.test(text))
    return 'Device did not respond. Check its address and network connection.'
  if (/401|403|authentication|login failed/i.test(text))
    return 'Device authentication failed. Check the session credentials.'
  return text.length > 220 ? text.slice(0, 217) + '…' : text
}
export function DeviceDialog({
  workspace,
  close,
  readOnly,
  initialSelection,
}: {
  workspace: Workspace
  close: () => void
  readOnly: boolean
  initialSelection?: string
}) {
  const states = useSyncExternalStore(desk.recorders.subscribe, desk.recorders.getSnapshot)
  const [selected, setSelected] = useState(initialSelection ?? '')
  const [address, setAddress] = useState(''),
    [label, setLabel] = useState(''),
    [type, setType] = useState<DeviceType>('auto'),
    [demo, setDemo] = useState(false)
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('')
  const [start, setStart] = useState(''),
    [end, setEnd] = useState('')
  const [busy, setBusy] = useState<string>(),
    [scanning, setScanning] = useState(false),
    [scanApproving, setScanApproving] = useState(false),
    [scanState, setScanState] = useState('Not started')
  const [addStage, setAddStage] = useState('')
  const [results, setResults] = useState<Record<string, DiscoveryResult>>({}),
    [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState(''),
    [scanError, setScanError] = useState(''),
    [exporting, setExporting] = useState(false)
  const [qr, setQr] = useState<string>()
  const [preparingQr, setPreparingQr] = useState(false)
  const abort = useRef<AbortController | undefined>(undefined),
    scanAbort = useRef<AbortController | undefined>(undefined),
    adapters = useRef(new Set<AjaAdapter>()),
    mounted = useRef(true)
  const cancel = () => {
    if (!abort.current) return
    diagnostics.event({ action: 'connect-cancelled', origin: busy })
    setNotice('Connection cancelled. Diagnostic QR can show the last step.')
    abort.current?.abort()
    window.dispatchEvent(new CustomEvent('signalshade-approval-cancel'))
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abort.current?.abort()
      scanAbort.current?.abort()
      adapters.current.forEach((a) => a.dispose())
      window.dispatchEvent(new CustomEvent('signalshade-approval-cancel'))
    }
  }, [])
  const configs = workspace.recorders ?? []
  const recordersRef = useRef(configs)
  recordersRef.current = configs
  const addDevice = async (
    ip: string,
    name = '',
    fromScan = false,
    hint: DeviceType = 'auto',
    sessionPassword = password,
  ) => {
    if (abort.current || scanApproving || readOnly) return
    let origin: string
    try {
      origin = normalizeAddress(ip)
    } catch (e) {
      setNotice(message(e))
      return
    }
    const controller = new AbortController()
    diagnostics.beginDeviceAttempt(origin)
    abort.current = controller
    setBusy(origin)
    setNotice('')
    setErrors((prev) => ({ ...prev, [origin]: '' }))
    let stage = ''
    const progress = (next: string) => {
      if (controller.signal.aborted || next === stage) return
      stage = next
      diagnostics.event({ action: 'add-stage', origin, stage })
      if (mounted.current) setAddStage(stage)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    progress('Checking device access')
    let adapter: AjaAdapter | undefined,
      kept = false,
      scanAccess = false
    try {
      if (
        !sessionPassword &&
        (fromScan || scanning || Object.keys(results).length) &&
        (await detectConnect(controller.signal))
      ) {
        scanAccess = !!(
          (await bridgeMessage(
            'scan-status',
            { start: origin, end: origin },
            controller.signal,
          )) as {
            allowed: boolean
          }
        ).allowed
      }
      if (!scanAccess) await ensureDeviceAccess(origin, undefined, controller.signal)
      if (controller.signal.aborted) return
      timer = setTimeout(() => {
        const error = `Add timed out while ${stage.toLowerCase()}. Use Diagnostic QR to share where it stopped.`
        diagnostics.event({ action: 'connect-failed', origin, error })
        controller.abort()
        if (mounted.current) setErrors((prev) => ({ ...prev, [origin]: error }))
      }, addTimeout)
      adapter = new AjaAdapter(
        origin,
        username || sessionPassword
          ? `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${sessionPassword}`)))}`
          : undefined,
      )
      adapters.current.add(adapter)
      let model: DeviceType = hint
      if (model === 'auto') {
        progress('Checking device web identity')
        const info = (await adapter.request('device-info', controller.signal).catch((error) => {
          diagnostics.event({ action: 'identity-page-unavailable', origin, error: message(error) })
          return {}
        })) as {
          model?: string
          title?: string
          aja?: boolean
        }
        if (info.aja)
          model = detectRecorderModel(`${info.title ?? ''} ${info.model ?? ''}`) ?? 'auto'
        if (info.aja && info.model)
          diagnostics.event({ action: 'device-identity', origin, model: info.model })
      }
      if (controller.signal.aborted) return
      if (isRecorder(model)) {
        progress('Reading recorder status')
        const old = recordersRef.current.find((c) => !c.simulated && c.address === origin)
        const config: RecorderConfig = old
          ? { ...old, label: name.trim() || old.label }
          : {
              id: crypto.randomUUID(),
              label: name.trim() || model,
              address: origin,
              model,
              simulated: false,
              warningMinutes: 15,
              autoConnect: false,
            }
        if (!old) desk.saveRecorders([...recordersRef.current, config])
        const cancelRecorder = () => desk.recorders.disconnect(config.id)
        controller.signal.addEventListener('abort', cancelRecorder, { once: true })
        try {
          await untilAborted(desk.recorders.connect(config, sessionPassword), controller.signal)
        } finally {
          controller.signal.removeEventListener('abort', cancelRecorder)
        }
        if (controller.signal.aborted) return
        const state = desk.recorders.getSnapshot()[config.id]
        if (state?.state === 'offline' || !state?.updatedAt)
          throw new Error(state?.issue ?? 'Recorder did not respond')
        if (controller.signal.aborted) {
          return
        }
        if (scanAccess) await bridgeMessage('adopt', { origin }, controller.signal)
        if (controller.signal.aborted) return
        diagnostics.event({ action: 'recorder-connected', origin, model })
        setNotice(`${config.label} connected`)
      } else {
        const report = await untilAborted(
          adapter.probe(controller.signal, model === 'auto' ? undefined : model, progress),
          controller.signal,
        )
        if (!mounted.current || controller.signal.aborted) return
        diagnostics.report(origin, report)
        if (
          !report.model ||
          !report.channels.length ||
          report.checks.some((c) => c.status === 'fail')
        )
          throw new Error(
            report.checks
              .filter((c) => c.status === 'fail')
              .map((c) => c.detail)
              .join(' ') || 'No supported controls found',
          )
        progress('Saving device connection')
        if (scanAccess) await bridgeMessage('adopt', { origin }, controller.signal)
        if (controller.signal.aborted) return
        desk.connect(adapter, report, name)
        kept = true
        const missing = report.checks.some((check) =>
          check.detail.startsWith('Active input mapping missing'),
        )
        setNotice(
          !report.descriptors.length
            ? `${name || report.model} added for monitoring. No color controls could be mapped. Open Diagnostic QR for details.`
            : `${name || report.model} added read-only. ${missing ? 'Some controls could not be mapped. ' : ''}Enable writes in device details when ready.`,
        )
      }
      diagnostics.event({ action: 'connect-complete', origin })
      setPassword('')
    } catch (e) {
      if (!controller.signal.aborted) {
        diagnostics.event({ action: 'connect-failed', origin, error: message(e) })
        if (mounted.current) setErrors((prev) => ({ ...prev, [origin]: conciseError(message(e)) }))
      }
    } finally {
      clearTimeout(timer)
      if (adapter) {
        adapters.current.delete(adapter)
        if (!kept) adapter.dispose()
      }
      if (abort.current === controller) abort.current = undefined
      if (mounted.current) {
        setBusy(undefined)
        setAddStage('')
      }
    }
  }
  const runScan = async () => {
    if (scanAbort.current || abort.current || readOnly) return
    let ips: string[]
    try {
      ips = ipv4Range(start, end)
    } catch (e) {
      setScanError(message(e))
      return
    }
    const controller = new AbortController()
    scanAbort.current = controller
    setScanning(true)
    setScanApproving(true)
    setScanError('')
    setScanState('Waiting for access…')
    try {
      await ensureDeviceAccess(normalizeAddress(ips[0]), {
        start: normalizeAddress(ips[0]),
        end: normalizeAddress(ips.at(-1)!),
      })
      if (controller.signal.aborted) return
      setScanApproving(false)
      setScanState(`0 / ${ips.length} checked`)
      diagnostics.event({ action: 'scan-start', start: ips[0], end: ips.at(-1) })
      await scanDevices(
        ips,
        controller.signal,
        (r) => {
          diagnostics.scan(r)
          setResults((prev) => ({ ...prev, [r.address]: r }))
        },
        (n) => setScanState(`${n} / ${ips.length} checked`),
      )
      if (mounted.current)
        setScanState((prev) => `${prev} · ${controller.signal.aborted ? 'Stopped' : 'Complete'}`)
    } catch (e) {
      diagnostics.event({
        action: 'scan-ended',
        error: message(e),
        cancelled: controller.signal.aborted,
      })
      if (mounted.current) {
        if (!controller.signal.aborted) setScanError(conciseError(message(e)))
        setScanState(controller.signal.aborted ? 'Stopped' : 'Not completed')
      }
    } finally {
      if (scanAbort.current === controller) scanAbort.current = undefined
      if (mounted.current) {
        setScanning(false)
        setScanApproving(false)
      }
    }
  }
  const downloadDebug = async () => {
    setExporting(true)
    try {
      await downloadDebugPackage(
        workspace,
        desk.getSnapshot().activities,
        states,
        await detectConnect(),
      )
    } catch (e) {
      setNotice(`Could not create debug ZIP: ${message(e)}`)
    } finally {
      if (mounted.current) setExporting(false)
    }
  }
  const remove = (id: string, recorder: boolean) => {
    try {
      if (recorder) desk.saveRecorders(recordersRef.current.filter((c) => c.id !== id))
      else desk.removeDevice(id)
      setNotice('')
      setSelected('')
    } catch (e) {
      setNotice(message(e))
    }
  }
  const sorted = Object.values(results).sort(
    (a, b) =>
      Number(new URL(a.address).hostname.split('.').at(-1)) -
      Number(new URL(b.address).hostname.split('.').at(-1)),
  )
  const visible = sorted.filter((r) => r.status === 'found'),
    device = workspace.devices.find((d) => d.id === selected),
    recorder = configs.find((c) => c.id === selected)
  const currentOrigin = (() => {
    try {
      return normalizeAddress(address)
    } catch {
      return ''
    }
  })()
  const added = (origin: string) =>
    workspace.devices.some((d) => !d.simulated && d.address === origin) ||
    configs.some((c) => !c.simulated && c.address === origin)
  const showQr = async (origin?: string, modelHint?: string) => {
    setPreparingQr(true)
    try {
      const extension = await detectConnect()
      const capture = diagnostics.snapshot()
      const latest = [...capture.events].reverse().find((event) => {
        const e = event as { action?: string }
        return e.action === 'device-attempt' || e.action === 'connect-failed'
      }) as { origin?: string } | undefined
      const chosen = origin || latest?.origin || ''
      const known = [...capture.events].reverse().find((event) => {
        const e = event as { action?: string; origin?: string }
        return e.action === 'device-identity' && e.origin === chosen
      }) as { model?: string } | undefined
      if (mounted.current)
        setQr(
          diagnosticSummary(
            capture,
            chosen,
            extension,
            modelHint === 'auto' || !modelHint ? known?.model : modelHint,
          ),
        )
    } finally {
      if (mounted.current) setPreparingQr(false)
    }
  }
  const qrButton = (origin?: string, hint?: string) => (
    <button
      type="button"
      className="button small"
      disabled={preparingQr}
      onClick={() => void showQr(origin, hint)}
    >
      <QrCode size={15} /> Diagnostic QR
    </button>
  )
  const addDemo = () => {
    try {
      if (type === 'auto') throw new Error('Choose a demo device type')
      if (isRecorder(type))
        desk.saveRecorders([
          ...configs,
          { ...demoRecorder(type), label: label.trim() || `${type} demo` },
        ])
      else desk.addDemoDevice(type, label)
      setNotice(`${type} demo added`)
    } catch (e) {
      setNotice(message(e))
    }
  }
  if (qr) return <DiagnosticQr summary={qr} close={() => setQr(undefined)} />
  return (
    <Modal
      title="Devices"
      subtitle="Processors and recorders in one place."
      close={close}
      wide
      className="connections-modal"
    >
      <div className="connections-toolbar">
        <span>{workspace.devices.length + configs.length} added</span>
        <div className="diagnostics-actions">
          {qrButton(
            device?.address || recorder?.address || currentOrigin,
            device?.model || recorder?.model || type,
          )}
          <button
            className="button small"
            onClick={() => void downloadDebug()}
            disabled={exporting}
          >
            <Download size={15} />
            {exporting ? 'Packaging…' : 'Download debug ZIP'}
          </button>
        </div>
      </div>
      {busy && (
        <div className="connection-progress">
          <p role="status">{addStage}…</p>
          <button type="button" className="button small" onClick={cancel}>
            Cancel connection
          </button>
          {qrButton(busy, type)}
        </div>
      )}
      <div className="connections-layout">
        <nav className="connections-list" aria-label="Added devices">
          <button
            className={`connection-add ${!selected ? 'selected' : ''}`}
            onClick={() => setSelected('')}
          >
            <Plus size={18} />
            Add device
          </button>
          {!workspace.devices.length && !configs.length && (
            <p className="muted">No devices added</p>
          )}
          {workspace.devices.map((d) => (
            <button
              key={d.id}
              className={`connection-list-item ${selected === d.id ? 'selected' : ''}`}
              aria-pressed={selected === d.id}
              onClick={() => setSelected(d.id)}
            >
              <Server size={20} />
              <span className="grow">
                <strong>{d.label}</strong>
                <small>
                  {d.model}
                  {d.simulated && <b className="device-demo-badge">DEMO</b>}
                </small>
                <span
                  className={`connection-state ${d.status === 'online' ? 'connected' : 'offline'}`}
                >
                  <i />
                  {d.status === 'online' ? 'Connected' : 'Offline'}
                  {d.status === 'online' && !d.armed ? ' · Locked' : ''}
                </span>
              </span>
            </button>
          ))}
          {configs.map((c) => {
            const s = states[c.id],
              state = s?.state ?? 'offline',
              connected = s?.updatedAt && state !== 'offline'
            return (
              <button
                key={c.id}
                className={`connection-list-item ${selected === c.id ? 'selected' : ''}`}
                aria-pressed={selected === c.id}
                onClick={() => setSelected(c.id)}
              >
                <Circle size={20} />
                <span className="grow">
                  <strong>{c.label}</strong>
                  <small>
                    {c.model}
                    {c.simulated && <b className="device-demo-badge">DEMO</b>}
                  </small>
                  <span
                    className={`connection-state ${state === 'recording' ? 'recording' : connected ? 'connected' : 'offline'}`}
                  >
                    <i />
                    {recorderStateLabel[state]}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>
        <div className="connections-content">
          {(device || recorder) && (
            <DeviceDetails
              key={selected}
              workspace={workspace}
              device={device}
              recorder={recorder}
              snapshot={recorder ? states[recorder.id] : undefined}
              busy={!!busy}
              readOnly={readOnly}
              notice={setNotice}
              remove={() => remove(selected, !!recorder)}
              reconnect={(pass) =>
                void addDevice(
                  (device ?? recorder)!.address,
                  (device ?? recorder)!.label,
                  false,
                  (device ?? recorder)!.model,
                  pass,
                )
              }
            />
          )}
          {(device?.issue || (recorder && states[recorder.id]?.issue)) && (
            <p className="text-warning">
              {conciseError(device?.issue ?? states[recorder!.id]?.issue ?? '')}
            </p>
          )}
          {errors[(device ?? recorder)?.address ?? ''] && (
            <p className="text-error">{errors[(device ?? recorder)!.address]}</p>
          )}
          {!device && !recorder && (
            <section className="device-section" aria-label="Add by IP">
              <h3>Add device</h3>
              <div className="segmented connection-source">
                <button
                  type="button"
                  className={!demo ? 'active' : ''}
                  onClick={() => setDemo(false)}
                >
                  Network device
                </button>
                <button
                  type="button"
                  className={demo ? 'active' : ''}
                  onClick={() => {
                    setDemo(true)
                    if (type === 'auto') setType('FS4')
                  }}
                >
                  Demo device
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (demo) addDemo()
                  else void addDevice(address, label, false, type)
                }}
              >
                <div className="form-inline">
                  <label className="field grow">
                    Device type
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value as DeviceType)}
                      disabled={!!busy || readOnly}
                    >
                      {!demo && <option value="auto">Auto detect</option>}
                      <optgroup label="Processors">
                        {fsModels.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Recorders">
                        {recorderModels.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <label className="field grow">
                    Label (optional)
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      maxLength={100}
                      placeholder={demo ? 'Demo device' : 'Device name'}
                      disabled={!!busy || readOnly}
                    />
                  </label>
                </div>
                <div className="form-inline">
                  {!demo && (
                    <label className="field grow">
                      IP address
                      <input
                        required
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="10.215.20.225"
                        disabled={!!busy || scanApproving || readOnly}
                        onBlur={() => {
                          if (!start) {
                            try {
                              const prefix = new URL(normalizeAddress(address)).hostname
                                .split('.')
                                .slice(0, 3)
                                .join('.')
                              setStart(`${prefix}.1`)
                              setEnd(`${prefix}.254`)
                            } catch {}
                          }
                        }}
                      />
                    </label>
                  )}
                  <button className="button primary" disabled={!!busy || scanApproving || readOnly}>
                    {busy === currentOrigin ? 'Adding…' : demo ? 'Add demo device' : 'Add device'}
                  </button>
                </div>
                {!demo && (
                  <details className="connection-options">
                    <summary>Authentication (optional)</summary>
                    <div className="form-inline">
                      <label className="field grow">
                        Username (FS only)
                        <input
                          autoComplete="off"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          disabled={!!busy}
                        />
                      </label>
                      <label className="field grow">
                        Session password
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
                )}
              </form>
              {errors[currentOrigin] && (
                <p className="text-error" role="alert">
                  {errors[currentOrigin]}
                </p>
              )}
              {errors[currentOrigin] && qrButton(currentOrigin, type)}
            </section>
          )}
          {(!selected || scanning) && (
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
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      placeholder="10.215.20.1"
                      disabled={scanning || !!busy || readOnly}
                    />
                  </label>
                  <label className="field grow">
                    End address
                    <input
                      required
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                      placeholder="10.215.20.254"
                      disabled={scanning || !!busy || readOnly}
                    />
                  </label>
                  <button className="button primary" disabled={scanning || !!busy || readOnly}>
                    <Search size={15} />
                    {scanning ? 'Scanning…' : 'Scan network'}
                  </button>
                </div>
              </form>
              <p className="muted" role="status">
                {scanState} · {visible.length} AJA devices
              </p>
              {scanError && (
                <p className="text-error" role="alert">
                  {scanError}
                </p>
              )}
              <div className="scan-results">
                {visible.map((r) => (
                  <div className="scan-result" key={r.address}>
                    <div className="grow">
                      <strong>{r.name ?? r.model ?? r.title ?? 'AJA device'}</strong>
                      <p>
                        {r.name ? `${r.model ?? 'AJA device'} · ` : ''}
                        {r.address}
                      </p>
                      {errors[r.address] && <p className="text-error">{errors[r.address]}</p>}
                      {errors[r.address] && qrButton(r.address, r.model)}
                    </div>
                    <button
                      className="button small"
                      disabled={added(r.address) || !!busy || scanApproving || readOnly}
                      onClick={() =>
                        void addDevice(
                          r.address,
                          r.name ?? '',
                          true,
                          detectRecorderModel(`${r.title ?? ''} ${r.model ?? ''}`) ??
                            (fsModels.includes(r.model as Model) ? (r.model as Model) : 'auto'),
                        )
                      }
                    >
                      {added(r.address) ? 'Added' : busy === r.address ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div className="connection-progress">
            {notice && <p role="status">{notice}</p>}
            {scanning && (
              <button
                className="button"
                onClick={() => {
                  scanAbort.current?.abort()
                  if (scanApproving)
                    window.dispatchEvent(new CustomEvent('signalshade-approval-cancel'))
                }}
              >
                Stop scan
              </button>
            )}
          </div>
          <ConnectHelp />
        </div>
      </div>
    </Modal>
  )
}
