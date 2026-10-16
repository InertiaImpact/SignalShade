import { useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { desk } from '../core/store'
import type { Device, Workspace } from '../core/types'
import { disconnected, type RecorderConfig, type RecorderSnapshot } from '../recorders/types'
import { RecorderStatus } from './RecorderStatus'
export function DeviceDetails({
  workspace,
  device,
  recorder,
  snapshot,
  busy,
  readOnly,
  reconnect,
  remove,
  notice,
}: {
  workspace: Workspace
  device?: Device
  recorder?: RecorderConfig
  snapshot?: RecorderSnapshot
  busy: boolean
  readOnly: boolean
  reconnect: (password?: string) => void
  remove: () => void
  notice: (message: string) => void
}) {
  const [password, setPassword] = useState('')
  const item = device ?? recorder!
  const saveRecorder = (patch: Partial<RecorderConfig>) =>
    desk.saveRecorders(
      (workspace.recorders ?? []).map((c) => (c.id === item.id ? { ...c, ...patch } : c)),
    )
  const act = (task: () => void) => {
    try {
      task()
    } catch (e) {
      notice(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <section className="connection-details" aria-label="Device settings">
      <div className="connection-details-heading">
        <div>
          <span className="eyebrow">
            {item.model}
            {item.simulated ? ' · DEMO' : ''}
          </span>
          <input
            className="device-name-input"
            aria-label="Device label"
            defaultValue={item.label}
            key={item.id}
            maxLength={100}
            disabled={readOnly || busy}
            onBlur={(e) => {
              const label = e.target.value.trim()
              if (!label) {
                e.target.value = item.label
                return
              }
              act(() => (device ? desk.renameDevice(item.id, label) : saveRecorder({ label })))
            }}
          />
          {!item.simulated && (
            <a className="muted" href={item.address} target="_blank" rel="noreferrer">
              {item.address}
            </a>
          )}
        </div>
        <button
          className="icon-button"
          disabled={readOnly || busy || !!snapshot?.pending}
          aria-label={`Remove ${item.label}`}
          title="Remove from dashboard"
          onClick={remove}
        >
          <Trash2 size={18} />
        </button>
      </div>
      {device && (
        <>
          <p className="muted">
            {device.firmware} · {workspace.channels.filter((c) => c.deviceId === device.id).length}{' '}
            {workspace.channels.filter((c) => c.deviceId === device.id).length === 1
              ? 'processor'
              : 'processors'}
          </p>
          <div className="processor-label-list">
            {workspace.channels
              .filter((c) => c.deviceId === device.id)
              .map((c) => (
                <label key={c.id} className="field">
                  <span>Video {c.processor}</span>
                  <input
                    defaultValue={c.label}
                    key={`${c.id}:${c.label}`}
                    aria-label={`Video ${c.processor} label`}
                    maxLength={100}
                    disabled={readOnly}
                    onBlur={(e) => {
                      const label = e.target.value.trim()
                      if (label) act(() => desk.updateChannel(c.id, { label }))
                    }}
                  />
                  <small>
                    {c.source} · {c.format}
                  </small>
                </label>
              ))}
          </div>
          <p className="muted">
            Labels and groups stay with the processor. Input changes never reset color.
          </p>
        </>
      )}
      {recorder && <RecorderStatus config={recorder} snapshot={snapshot ?? disconnected()} />}
      <div className="button-row">
        {!item.simulated && (
          <button
            className="button"
            disabled={readOnly || busy || !!snapshot?.pending}
            onClick={() => {
              reconnect(password)
              setPassword('')
            }}
          >
            <RefreshCw size={15} />
            {busy ? 'Connecting…' : 'Reconnect'}
          </button>
        )}
        {device && (
          <button
            className="button"
            disabled={readOnly || busy || device.status !== 'online'}
            onClick={() => act(() => desk.armDevice(device.id, !device.armed))}
          >
            {device.armed ? 'Lock control' : 'Enable control'}
          </button>
        )}
        {recorder && (
          <button
            className="button"
            disabled={
              readOnly ||
              busy ||
              !snapshot?.canControl ||
              !!snapshot?.pending ||
              snapshot.state === 'offline'
            }
            onClick={() => act(() => desk.recorders.enable(recorder.id, !snapshot?.enabled))}
          >
            {snapshot?.enabled ? 'Lock control' : 'Enable control'}
          </button>
        )}
      </div>
      {recorder && (
        <details className="connection-options">
          <summary>Connection options</summary>
          <div className="form-inline">
            <label className="field">
              Warn below (minutes)
              <input
                type="number"
                min={0}
                max={1440}
                defaultValue={recorder.warningMinutes}
                disabled={readOnly || busy}
                onBlur={(e) => {
                  const n = e.target.valueAsNumber
                  if (Number.isFinite(n) && n >= 0 && n <= 1440)
                    act(() => saveRecorder({ warningMinutes: n }))
                }}
              />
            </label>
            {!recorder.simulated && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={recorder.autoConnect ?? false}
                  disabled={readOnly || busy}
                  onChange={(e) => act(() => saveRecorder({ autoConnect: e.target.checked }))}
                />
                Reconnect on load
              </label>
            )}
          </div>
        </details>
      )}
      {!item.simulated && (
        <details className="connection-options">
          <summary>Session password</summary>
          <label className="field">
            Password
            <input
              type="password"
              value={password}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || readOnly}
            />
          </label>
        </details>
      )}
    </section>
  )
}
