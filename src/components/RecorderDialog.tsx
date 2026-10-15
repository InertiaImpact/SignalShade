import { useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { desk } from '../core/store'
import { message, normalizeAddress } from '../adapters/aja'
import { recorderModels, type RecorderConfig, type RecorderModel } from '../recorders/types'
import { demoRecorder } from '../recorders/demo'
import { downloadJson } from '../core/persistence'
import { Modal } from './Modal'
import { ConnectHelp } from './ConnectHelp'
import { ensureDeviceAccess } from '../adapters/transport'

export function RecorderDialog({
  configs,
  readOnly,
  close,
}: {
  configs: RecorderConfig[]
  readOnly: boolean
  close: () => void
}) {
  const states = useSyncExternalStore(desk.recorders.subscribe, desk.recorders.getSnapshot)
  const [label, setLabel] = useState(''),
    [address, setAddress] = useState(''),
    [model, setModel] = useState<RecorderModel>('HELO')
  const [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<string>()
  const save = (next: RecorderConfig[]) => {
    try {
      desk.saveRecorders(next)
      setError('')
    } catch (e) {
      setError(message(e))
    }
  }
  const connect = async (config: RecorderConfig) => {
    setBusy(config.id)
    setError('')
    try {
      if (!config.simulated) await ensureDeviceAccess(config.address)
      await desk.recorders.connect(config, password)
    } catch (e) {
      setError(message(e))
    } finally {
      setPassword('')
      setBusy(undefined)
    }
  }
  const move = (index: number, direction: number) => {
    const next = [...configs]
    const other = index + direction
    if (other < 0 || other >= next.length) return
    ;[next[index], next[other]] = [next[other], next[index]]
    save(next)
  }
  return (
    <Modal
      title="Recorders"
      subtitle="Monitoring reconnects automatically. Control is remembered within this tab."
      close={close}
      wide
    >
      <ConnectHelp />
      <div className="recorder-settings-list">
        {configs.map((config, index) => {
          const state = states[config.id]
          return (
            <section key={config.id} className="recorder-settings-item">
              <div className="form-inline">
                <label className="field grow">
                  Label
                  <input
                    aria-label={`${config.label} label`}
                    defaultValue={config.label}
                    maxLength={100}
                    disabled={readOnly}
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name)
                        save(configs.map((c) => (c.id === config.id ? { ...c, label: name } : c)))
                      else e.target.value = config.label
                    }}
                  />
                </label>
                <label className="field">
                  Warn below (min)
                  <input
                    aria-label={`${config.label} warning minutes`}
                    type="number"
                    min={0}
                    max={1440}
                    defaultValue={config.warningMinutes}
                    disabled={readOnly}
                    onBlur={(e) => {
                      const value = e.target.valueAsNumber
                      if (Number.isFinite(value) && value >= 0 && value <= 1440)
                        save(
                          configs.map((c) =>
                            c.id === config.id ? { ...c, warningMinutes: value } : c,
                          ),
                        )
                      else e.target.value = String(config.warningMinutes)
                    }}
                  />
                </label>
              </div>
              <div className="recorder-settings-actions">
                <span>
                  {config.model} · {config.simulated ? 'DEMO' : config.address}
                </span>
                <button
                  className="button"
                  disabled={readOnly || !!busy || !!state?.pending}
                  onClick={() => void connect(config)}
                >
                  {busy === config.id ? 'Connecting…' : state?.updatedAt ? 'Reconnect' : 'Connect'}
                </button>
                <label className="check-row">
                  <input
                    type="checkbox"
                    aria-label={`${config.label} control`}
                    checked={state?.enabled ?? false}
                    disabled={
                      readOnly ||
                      !!busy ||
                      !state?.canControl ||
                      !!state?.pending ||
                      !state?.updatedAt ||
                      state.state === 'offline'
                    }
                    onChange={(e) => desk.recorders.enable(config.id, e.target.checked)}
                  />
                  Enable control
                </label>
                {!config.simulated && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      aria-label={`${config.label} reconnect automatically`}
                      checked={config.autoConnect ?? false}
                      disabled={readOnly || !!busy || !!state?.pending}
                      onChange={(e) =>
                        save(
                          configs.map((c) =>
                            c.id === config.id ? { ...c, autoConnect: e.target.checked } : c,
                          ),
                        )
                      }
                    />
                    Reconnect on load
                  </label>
                )}
                <button
                  className="icon-button"
                  aria-label={`Move ${config.label} earlier`}
                  disabled={readOnly || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Move ${config.label} later`}
                  disabled={readOnly || index === configs.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove ${config.label}`}
                  title="Remove from dashboard; recording continues"
                  disabled={readOnly || !!state?.pending || !!busy}
                  onClick={() => save(configs.filter((c) => c.id !== config.id))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {state?.issue && <p className="text-warning">{state.issue}</p>}
              {!config.simulated && (
                <small className="muted">
                  {state?.controlReason ? `${state.controlReason} · ` : ''}
                  {state?.scope ?? 'Device-wide control'}
                </small>
              )}
            </section>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="text-warning">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          try {
            const config: RecorderConfig = {
              id: crypto.randomUUID(),
              label: label.trim() || model,
              model,
              address: normalizeAddress(address),
              simulated: false,
              warningMinutes: 15,
            }
            desk.saveRecorders([...configs, config])
            void connect(config)
            setAddress('')
            setLabel('')
          } catch (e) {
            setError(message(e))
          }
        }}
      >
        <fieldset disabled={readOnly || !!busy || configs.length >= 16} className="recorder-add">
          <legend>Add recorder</legend>
          <div className="form-inline">
            <label className="field grow">
              Label
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={100}
                placeholder="Program record"
              />
            </label>
            <label className="field">
              Model
              <select value={model} onChange={(e) => setModel(e.target.value as RecorderModel)}>
                {recorderModels.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-inline">
            <label className="field grow">
              IP address
              <input
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="192.168.1.30"
              />
            </label>
            <label className="field">
              Session password (optional)
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Password is used for Connect/Reconnect and never saved or exported. Direct browser
            access requires device CORS and LAN permission; authenticated sessions also require
            browser cookie support.
          </p>
          <div className="modal-footer">
            <button
              type="button"
              className="button"
              onClick={() => save([...configs, demoRecorder(model)])}
            >
              Add simulated recorder
            </button>
            <button className="button primary">Add & connect</button>
          </div>
        </fieldset>
      </form>
      <div className="modal-footer">
        <button
          className="button"
          onClick={() =>
            downloadJson('signalshade-recorder-status.json', { configs, snapshots: states })
          }
        >
          Export diagnostics
        </button>
        <button className="button" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  )
}
