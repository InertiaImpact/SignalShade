import { useState } from 'react'
import { Check, Download, Layers3, Plus, Save, Trash2 } from 'lucide-react'
import { parameters, sections } from '../core/color'
import { downloadJson } from '../core/persistence'
import { desk } from '../core/store'
import type { ColorPreset, Gang, ParameterId, Section, Workspace } from '../core/types'
import { Modal } from './Modal'
import { message } from '../adapters/aja'
import { defaultLayout, visibleSections } from '../core/layout'
import { broadcastTheme } from '../theme'

export function GangDialog({
  workspace,
  gang,
  initialMembers = [],
  close,
}: {
  workspace: Workspace
  gang?: Gang
  initialMembers?: string[]
  close: () => void
}) {
  const [name, setName] = useState(gang?.name ?? ''),
    [color, setColor] = useState<string>(gang?.color ?? broadcastTheme.accent),
    [members, setMembers] = useState(gang?.members ?? initialMembers),
    [mask, setMask] = useState<ParameterId[]>(gang?.parameters ?? []),
    [error, setError] = useState('')
  const descriptors = [
    ...new Map(workspace.channels.flatMap((c) => c.descriptors).map((d) => [d.id, d])).values(),
  ]
  return (
    <Modal
      title={gang ? 'Edit gang group' : 'Create gang group'}
      subtitle="Shared controls. Individual starting values. Groups may overlap."
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          try {
            desk.saveGang({
              id: gang?.id ?? crypto.randomUUID(),
              name,
              color,
              members,
              parameters: mask,
            })
            close()
          } catch (e) {
            setError(message(e))
          }
        }}
      >
        <div className="form-inline">
          <label className="field grow">
            Group name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Studio cameras"
              required
            />
          </label>
          <label className="field">
            Accent
            <input
              aria-label="Group accent"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        </div>
        <div className="section-heading">
          <span>MEMBERS</span>
          <span>{members.length} selected</span>
        </div>
        <div className="member-list">
          {workspace.channels.map((c) => (
            <label className="check-row" key={c.id}>
              <input
                type="checkbox"
                checked={members.includes(c.id)}
                onChange={(e) =>
                  setMembers(
                    e.target.checked ? [...members, c.id] : members.filter((id) => id !== c.id),
                  )
                }
              />
              <span>
                <strong>{c.label}</strong>
                <small>
                  {workspace.devices.find((d) => d.id === c.deviceId)?.label} · VID {c.processor}
                </small>
              </span>
            </label>
          ))}
        </div>
        <details className="parameter-mask">
          <summary>
            Parameter mask · {mask.length ? `${mask.length} controls` : 'all compatible controls'}
          </summary>
          <p className="muted">
            Leave empty to control all compatible parameters, or choose only the controls this gang
            may change.
          </p>
          <div className="checkbox-grid">
            {descriptors.map((d) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={mask.includes(d.id)}
                  onChange={(e) =>
                    setMask(e.target.checked ? [...mask, d.id] : mask.filter((id) => id !== d.id))
                  }
                />
                {d.label}
              </label>
            ))}
          </div>
        </details>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          {gang && (
            <button
              type="button"
              className="button danger-text"
              onClick={() => {
                desk.deleteGang(gang.id)
                close()
              }}
            >
              <Trash2 size={15} />
              Delete group
            </button>
          )}
          <button className="button primary" type="submit" disabled={!members.length}>
            <Check size={16} />
            Save group
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function PresetDialog({
  workspace,
  targetIds,
  close,
  readOnly,
}: {
  workspace: Workspace
  targetIds: string[]
  close: () => void
  readOnly: boolean
}) {
  const [name, setName] = useState(''),
    [preset, setPreset] = useState<ColorPreset>(),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [enabled, setEnabled] = useState<string[]>([...sections]),
    [error, setError] = useState('')
  const [scope, setScope] = useState<'selected' | 'all'>('selected')
  const selectPreset = (p: ColorPreset) => {
    setPreset(p)
    setMapping(
      Object.fromEntries(
        p.channels.map((c) => [
          c.channelId,
          workspace.channels.some((t) => t.id === c.channelId) ? c.channelId : '',
        ]),
      ),
    )
    setError('')
  }
  return (
    <Modal
      title="Color presets"
      subtitle="Save a correction, recall a look. Presets contain color controls only."
      close={close}
      wide
    >
      <div className="preset-dialog-grid">
        <div>
          <div className="section-heading">
            <span>SAVED PRESETS</span>
            <span>{workspace.presets.length}</span>
          </div>
          <div className="preset-list">
            {workspace.presets.map((p) => (
              <div className={`preset-item ${preset?.id === p.id ? 'active' : ''}`} key={p.id}>
                <button onClick={() => selectPreset(p)}>
                  <Layers3 size={19} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.channels.length} channels · {new Date(p.createdAt).toLocaleDateString()}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete preset ${p.name}`}
                  disabled={readOnly}
                  onClick={() => {
                    desk.deletePreset(p.id)
                    if (preset?.id === p.id) setPreset(undefined)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!workspace.presets.length && (
              <div className="empty-small">
                <Layers3 size={28} />
                <h3>Your looks, ready to recall.</h3>
                <p>Save the current colors to create your first preset.</p>
              </div>
            )}
          </div>
          <div className="save-preset">
            <h3>Capture current colors</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                try {
                  desk.savePreset(
                    name,
                    scope === 'all' ? workspace.channels.map((c) => c.id) : targetIds,
                  )
                  setName('')
                  setError('')
                } catch (e) {
                  setError(message(e))
                }
              }}
            >
              <label className="field">
                Preset name
                <input
                  required
                  value={name}
                  maxLength={100}
                  placeholder="Opening look"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                Capture scope
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'selected' | 'all')}
                >
                  <option value="selected">Selected channel / gang ({targetIds.length})</option>
                  <option value="all">All channels ({workspace.channels.length})</option>
                </select>
              </label>
              <button className="button primary" disabled={readOnly || !workspace.channels.length}>
                <Save size={15} />
                Save preset
              </button>
            </form>
          </div>
        </div>
        <div>
          {preset ? (
            <>
              <h3>{preset.name}</h3>
              <p className="muted">
                Choose destinations and sections. Recall immediately sends the selected color
                values.
              </p>
              <div className="recall-mapping">
                {preset.channels.map((c) => (
                  <label className="field" key={c.channelId}>
                    {c.label}
                    <select
                      aria-label={`Target for ${c.label}`}
                      value={mapping[c.channelId] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [c.channelId]: e.target.value })}
                    >
                      <option value="">Skip this source</option>
                      {workspace.channels
                        .filter(
                          (t) =>
                            workspace.devices.find((d) => d.id === t.deviceId)?.model === c.model,
                        )
                        .map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.label}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="checkbox-grid">
                {sections.map((s) => (
                  <label key={s}>
                    <input
                      type="checkbox"
                      checked={enabled.includes(s)}
                      onChange={(e) =>
                        setEnabled(
                          e.target.checked ? [...enabled, s] : enabled.filter((v) => v !== s),
                        )
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={readOnly}
                  onClick={() => {
                    try {
                      desk.recallPreset(preset, mapping, enabled)
                      close()
                    } catch (e) {
                      setError(message(e))
                    }
                  }}
                >
                  <Check size={16} />
                  Recall selected colors
                </button>
                <button
                  className="button"
                  onClick={() =>
                    downloadJson(`${preset.name.replace(/[^a-z0-9]/gi, '-')}.json`, {
                      version: 1,
                      type: 'signalshade-color-preset',
                      preset,
                    })
                  }
                >
                  <Download size={16} />
                  Export
                </button>
              </div>
              <p className="muted">
                Only matching device models are offered. Unsupported values or resolutions block
                recall before commands are sent.
              </p>
            </>
          ) : (
            <div className="preset-placeholder">
              <Layers3 size={42} />
              <h3>Pick a preset to recall</h3>
              <p>
                Map sources to destinations while keeping routing and video configuration untouched.
              </p>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

export function LayoutDialog({ workspace, close }: { workspace: Workspace; close: () => void }) {
  const [favorites, setFavorites] = useState(workspace.favorites),
    [density, setDensity] = useState(workspace.density),
    [hidden, setHidden] = useState<Section[]>(
      sections.filter((s) => !visibleSections(workspace.hiddenSections).includes(s)),
    )
  const available = [
    ...new Map(
      [...parameters, ...workspace.channels.flatMap((c) => c.descriptors)]
        .filter((d) => d.kind === 'number')
        .map((d) => [d.id, d]),
    ).values(),
  ]
  return (
    <Modal
      title="Make it your desk"
      subtitle="Choose the controls and layout that suit your show."
      close={close}
    >
      <label className="field">
        Card density
        <select value={density} onChange={(e) => setDensity(e.target.value as typeof density)}>
          <option value="comfortable">Standard · compact channel cards</option>
          <option value="compact">Dense · smaller cards and spacing</option>
        </select>
      </label>
      <div className="section-heading">
        <span>QUICK CONTROLS</span>
        <span>{favorites.length} / 8</span>
      </div>
      <p className="muted">
        Choose up to eight quick controls. Four keeps the cards compact. All other controls remain
        available in the section tabs.
      </p>
      <div className="checkbox-grid">
        {available.map((d) => (
          <label key={d.id}>
            <input
              type="checkbox"
              checked={favorites.includes(d.id)}
              disabled={
                (!favorites.includes(d.id) && favorites.length >= 8) ||
                (favorites.includes(d.id) && favorites.length === 1)
              }
              onChange={(e) =>
                setFavorites(
                  e.target.checked ? [...favorites, d.id] : favorites.filter((id) => id !== d.id),
                )
              }
            />
            {d.label}
          </label>
        ))}
      </div>
      <div className="section-heading">
        <span>AVAILABLE CONTROL TABS</span>
      </div>
      <div className="checkbox-grid">
        {sections.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={!hidden.includes(s)}
              disabled={!hidden.includes(s) && visibleSections(hidden).length === 1}
              onChange={(e) =>
                setHidden(e.target.checked ? hidden.filter((v) => v !== s) : [...hidden, s])
              }
            />
            {s}
          </label>
        ))}
      </div>
      <p className="muted">
        Checked tabs are available on each card and in the gang console. Quick controls always
        remain accessible. At least one section tab must stay available.
      </p>
      <div className="modal-footer">
        <button
          className="button"
          onClick={() => {
            desk.updateWorkspace(defaultLayout())
            close()
          }}
        >
          Restore default layout
        </button>
        <button
          className="button primary"
          onClick={() => {
            desk.updateWorkspace({ favorites, density, hiddenSections: hidden })
            close()
          }}
        >
          <Check size={16} />
          Save layout
        </button>
      </div>
    </Modal>
  )
}

export function ResetDialog({
  workspace,
  ids,
  section,
  mask,
  close,
}: {
  workspace: Workspace
  ids: string[]
  section?: string
  mask?: ParameterId[]
  close: () => void
}) {
  const [includeEnables, setIncludeEnables] = useState(false)
  return (
    <Modal
      title={section ? `Reset ${section.toLowerCase()}` : 'Reset channel colors'}
      subtitle={`${ids.length} ${ids.length === 1 ? 'channel' : 'channels'} will change immediately.`}
      close={close}
    >
      <div className="notice warning">
        <p>
          Proc amp and RGB values return to unity. Legalizer controls return to device defaults when
          included. Enable states are preserved unless selected below. Only the current
          source-memory context is changed.
        </p>
      </div>
      <div className="reset-targets">
        {workspace.channels
          .filter((c) => ids.includes(c.id))
          .map((c) => (
            <span key={c.id}>{c.label}</span>
          ))}
      </div>
      {!!mask?.length && <p className="muted">This gang’s parameter mask applies to the reset.</p>}
      <label className="check-row">
        <input
          type="checkbox"
          checked={includeEnables}
          onChange={(e) => setIncludeEnables(e.target.checked)}
        />
        Also reset Proc Amp / RGB enable states to device defaults
      </label>
      <div className="modal-footer">
        <button className="button" onClick={close}>
          Cancel
        </button>
        <button
          className="button warning-button"
          onClick={() => {
            desk.reset(ids, section, includeEnables, mask)
            close()
          }}
        >
          Reset {ids.length} {ids.length === 1 ? 'channel' : 'channels'}
        </button>
      </div>
    </Modal>
  )
}

export function WorkspaceDialog({ workspace, close }: { workspace: Workspace; close: () => void }) {
  const [name, setName] = useState(workspace.name)
  return (
    <Modal
      title="Show workspace"
      subtitle="Your device labels, groups, layouts, and presets live in this browser."
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          desk.updateWorkspace({ name: name.trim() })
          close()
        }}
      >
        <label className="field">
          Workspace name
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </label>
        <p className="muted">
          Export a workspace backup to move your setup to another computer. Importing reconnects no
          devices and sends no color changes.
        </p>
        <div className="modal-footer">
          <button
            className="button"
            type="button"
            onClick={() => downloadJson('signalshade-workspace.json', workspace)}
          >
            <Download size={15} />
            Export backup
          </button>
          <button className="button primary">
            <Check size={15} />
            Save name
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function ConfirmWorkspace({
  kind,
  close,
  confirm,
}: {
  kind: string
  close: () => void
  confirm: () => void
}) {
  return (
    <Modal
      title={
        kind === 'empty'
          ? 'Start an empty workspace?'
          : kind === 'demo'
            ? 'Load the demo desk?'
            : 'Replace this workspace?'
      }
      subtitle="This replaces the setup stored in this browser. No commands are sent to devices."
      close={close}
    >
      <p>
        Export your current workspace first if you want to keep its labels, gang groups, and
        presets.
      </p>
      <div className="modal-footer">
        <button className="button" onClick={close}>
          Cancel
        </button>
        <button className="button primary" onClick={confirm}>
          <Plus size={16} />
          {kind === 'empty' ? 'Start empty' : kind === 'demo' ? 'Load demo' : 'Import workspace'}
        </button>
      </div>
    </Modal>
  )
}
