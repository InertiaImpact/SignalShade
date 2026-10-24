import { useState, type CSSProperties, type MouseEvent } from 'react'
import { ChevronRight, Layers3, RotateCcw, X } from 'lucide-react'
import {
  availableRgbFamilies,
  gangDescriptors,
  quickControls,
  quickStages,
  rgbControls,
  visibleControlSections,
  type RgbFamily,
} from '../core/layout'
import type { Gang, Section, Workspace } from '../core/types'
import { ParameterControl } from './ParameterControl'
import { RgbTabs } from './RgbTabs'
import { QuickStageControls } from './QuickStageControls'
import { ConvergeControls } from './ConvergeControls'

export function GangCard({
  gang,
  workspace,
  disabled,
  multiplier,
  onOpen,
  onHide,
  onReset,
  onSelect,
  selected = false,
  busy = false,
}: {
  gang: Gang
  workspace: Workspace
  disabled: boolean
  multiplier: number
  onOpen: () => void
  onHide: () => void
  onReset: (section?: Section) => void
  onSelect?: (event: MouseEvent<HTMLButtonElement>) => void
  selected?: boolean
  busy?: boolean
}) {
  const [relative, setRelative] = useState(true)
  const [tab, setTab] = useState<Section | 'quick'>('quick')
  const [family, setFamily] = useState<RgbFamily>('Gain')
  const channels = workspace.channels.filter((c) => gang.members.includes(c.id))
  const descriptors = gangDescriptors(channels, gang.parameters)
  const sections = visibleControlSections(workspace.hiddenSections).filter((s) =>
    descriptors.some((d) => d.section === s),
  )
  const activeTab = tab === 'quick' || !sections.includes(tab) ? 'quick' : tab
  const families = availableRgbFamilies(descriptors)
  const activeFamily = families.includes(family) ? family : (families[0] ?? 'Gain')
  const fields =
    activeTab === 'quick'
      ? quickControls({ descriptors }, workspace.favorites)
      : activeTab === 'RGB correction'
        ? [
            ...descriptors.filter((d) => d.id === 'rgbEnabled'),
            ...rgbControls(descriptors, activeFamily),
          ]
        : descriptors.filter((d) => d.section === activeTab)
  const blocked =
    disabled ||
    !channels.length ||
    channels.some((c) => {
      const device = workspace.devices.find((d) => d.id === c.deviceId)
      return c.locked || !!c.issue || !c.updatedAt || device?.status !== 'online' || !device.armed
    })
  const sectionTone =
    activeTab === 'RGB correction' ? 'rgb' : activeTab === 'Proc amp' ? 'procamp' : 'quick'
  const quickStageDescriptors =
    activeTab === 'quick' ? quickStages(fields, gangDescriptors(channels)) : []
  const controls = fields.filter((d) => !quickStageDescriptors.some((stage) => stage.id === d.id))

  return (
    <article
      className={`channel-card gang-card ${selected ? 'selected' : ''}`}
      aria-label={`${gang.name} gang card`}
      data-selection-id={gang.id}
      style={{ '--gang-color': gang.color, '--selection-color': gang.color } as CSSProperties}
    >
      <div className="card-heading">
        <button
          className="card-select"
          aria-label={`Open ${gang.name} gang controls`}
          aria-pressed={selected}
          onClick={onSelect ?? onOpen}
        >
          <span className="gang-card-icon">
            <Layers3 size={18} />
          </span>
          <span>
            <strong>{gang.name}</strong>
            <small>
              {channels.length} members{gang.parameters.length ? ' · Masked' : ''}
            </small>
          </span>
        </button>
        <div
          className="segmented gang-card-mode"
          role="group"
          aria-label={`${gang.name} adjustment mode`}
        >
          <button
            className={relative ? 'active' : ''}
            aria-pressed={relative}
            aria-label="Relative trim"
            title="Relative trim"
            onClick={() => setRelative(true)}
          >
            Rel
          </button>
          <button
            className={!relative ? 'active' : ''}
            aria-pressed={!relative}
            aria-label="Absolute set"
            title="Absolute set"
            onClick={() => setRelative(false)}
          >
            Abs
          </button>
        </div>
        <ConvergeControls
          ids={gang.members}
          workspace={workspace}
          masks={Object.fromEntries(gang.members.map((id) => [id, gang.parameters]))}
          disabled={disabled}
          busy={busy}
          compact
        />
        <span
          className="card-state"
          title={
            blocked ? 'A member is unavailable or controls are locked' : 'Gang ready to adjust'
          }
        >
          <span className={`status-dot ${blocked ? 'offline' : ''}`} />
        </span>
        <button
          className="icon-button tiny"
          disabled={disabled}
          aria-label={`Hide ${gang.name} card`}
          onClick={onHide}
        >
          <X size={13} />
        </button>
      </div>
      <div
        className="card-control-tabs"
        role="tablist"
        aria-label={`Controls for gang ${gang.name}`}
      >
        {(['quick', ...sections] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={activeTab === s}
            data-control-section={
              s === 'RGB correction' ? 'rgb' : s === 'Proc amp' ? 'procamp' : 'quick'
            }
            onClick={() => setTab(s)}
          >
            {s === 'quick' ? 'Quick' : s === 'RGB correction' ? 'RGB' : s}
          </button>
        ))}
        {activeTab !== 'quick' && (
          <button
            className="icon-button tiny section-reset"
            disabled={blocked}
            aria-label={`Reset ${activeTab} for gang ${gang.name}`}
            onClick={() => onReset(activeTab)}
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      {activeTab === 'RGB correction' && (
        <RgbTabs
          descriptors={descriptors}
          value={activeFamily}
          onChange={setFamily}
          label={`RGB controls for gang ${gang.name}`}
        />
      )}
      <div
        className={`card-parameters ${activeTab === 'RGB correction' ? 'rgb-parameters' : ''}`}
        role="tabpanel"
        aria-label={`${activeTab === 'quick' ? 'Quick' : activeTab} controls for gang ${gang.name}`}
        data-control-section={sectionTone}
      >
        <QuickStageControls
          descriptors={quickStageDescriptors}
          channels={channels}
          disabled={blocked}
          editableIds={descriptors.map((d) => d.id)}
          idPrefix={`quick-gang-${gang.id}`}
        />
        {controls.map((d) => (
          <ParameterControl
            key={`${d.id}-${relative}`}
            descriptor={d}
            channels={channels}
            relative={relative && d.kind === 'number'}
            disabled={blocked}
            multiplier={multiplier}
            compact
            idPrefix={`gang-${gang.id}`}
          />
        ))}
        {!fields.length && (
          <p className="card-controls-empty">No supported controls in this gang’s mask.</p>
        )}
      </div>
      <div className="card-bottom">
        <button className="gang-members-link" onClick={onOpen}>
          Members <ChevronRight size={12} />
        </button>
        <button
          className="icon-button tiny"
          disabled={blocked}
          aria-label={`Reset ${gang.name} gang colors`}
          onClick={() => onReset()}
        >
          <RotateCcw size={12} />
        </button>
      </div>
    </article>
  )
}
