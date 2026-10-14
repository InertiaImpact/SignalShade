import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  Edit3,
  FolderOpen,
  Grid2X2,
  Layers3,
  Lock,
  Monitor,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Star,
  Unlock,
  Upload,
  Waves,
  X,
} from 'lucide-react'
import { desk } from './core/store'
import { getWaitingUpdate, subscribeUpdates } from './core/updates'
import { commonValue, isCompatible } from './core/color'
import type { Channel, Gang, ParameterId, Section } from './core/types'
import { downloadJson, validateWorkspace } from './core/persistence'
import { message } from './adapters/aja'
import { ParameterControl } from './components/ParameterControl'
import { DeviceDialog } from './components/DeviceDialog'
import {
  ConfirmWorkspace,
  GangDialog,
  LayoutDialog,
  PresetDialog,
  ResetDialog,
  WorkspaceDialog,
} from './components/WorkspaceDialogs'
import { Modal } from './components/Modal'

import { useChannelSelection } from './components/useChannelSelection'
import { quickControls, visibleSections } from './core/layout'
import { toggleSelection } from './core/selection'
import type { MouseEvent } from 'react'

type Dialog = 'devices' | 'gang' | 'presets' | 'layout' | 'reset' | 'workspace' | 'help' | null
let initialized = false
export default function App() {
  const snapshot = useSyncExternalStore(desk.subscribe, desk.getSnapshot),
    { workspace: w } = snapshot
  const [view, setView] = useState('all'),
    [selected, setSelected] = useState('demo-ch-1'),
    [selection, setSelection] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('custom'),
    [dialog, setDialog] = useState<Dialog>(null)
  const [editGang, setEditGang] = useState<Gang>(),
    [resetScope, setResetScope] = useState<{
      ids: string[]
      section?: Section
      mask?: ParameterId[]
    }>({ ids: [] }),
    [relative, setRelative] = useState(true),
    [multiplier, setMultiplier] = useState(1),
    [section, setSection] = useState<Section>('Proc amp')
  const [activity, setActivity] = useState(false),
    [editLayout, setEditLayout] = useState(false),
    [menu, setMenu] = useState(false),
    [globalLock, setGlobalLock] = useState(false),
    [pendingWorkspace, setPendingWorkspace] = useState<{
      kind: 'demo' | 'empty' | 'import'
      data?: unknown
    }>(),
    [sidebar, setSidebar] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const update = useSyncExternalStore(subscribeUpdates, getWaitingUpdate)
  const close = () => setDialog(null)
  const group = w.gangs.find((g) => g.id === selected)
  const selectedChannel = w.channels.find((c) => c.id === selected)
  const selectedChannels = selection.length
    ? w.channels.filter((c) => selection.includes(c.id))
    : group
      ? w.channels.filter((c) => group.members.includes(c.id))
      : selectedChannel
        ? [selectedChannel]
        : []
  const targetIds = selectedChannels.map((c) => c.id)
  const batch = !!group || selectedChannels.length > 1
  const selectMany = (ids: string[]) => {
    setSelection(ids)
    setSelected('')
    setRelative(true)
  }
  const selectChannel = (id: string, additive = false) => {
    if (additive) selectMany(toggleSelection(targetIds, id))
    else {
      setSelection([])
      setSelected(id)
      setRelative(false)
    }
  }
  const selectionGesture = useChannelSelection(targetIds, selectMany, selectChannel)
  const { rectangle, preview, ...gridSelectionHandlers } = selectionGesture
  const currentViewGang = w.gangs.find((g) => g.id === view)
  const channels = useMemo(() => {
    let list = w.channels.filter(
      (c) =>
        (view === 'all' ||
          view === 'favorites' ||
          currentViewGang?.members.includes(c.id) ||
          c.deviceId === view) &&
        `${c.label} ${c.source} ${w.devices.find((d) => d.id === c.deviceId)?.label}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    if (sort === 'name') list = [...list].sort((a, b) => a.label.localeCompare(b.label))
    if (sort === 'device')
      list = [...list].sort(
        (a, b) => a.deviceId.localeCompare(b.deviceId) || a.processor - b.processor,
      )
    return list
  }, [w, view, currentViewGang, query, sort])
  const simulated = w.devices.filter((d) => d.simulated).length,
    online = w.devices.filter((d) => d.status === 'online').length
  const readOnly = snapshot.lockedTab || globalLock || !snapshot.ready
  const controlsDisabled =
    readOnly ||
    !selectedChannels.length ||
    selectedChannels.some(
      (c) =>
        c.locked ||
        c.issue ||
        !c.updatedAt ||
        w.devices.find((d) => d.id === c.deviceId)?.status !== 'online' ||
        !w.devices.find((d) => d.id === c.deviceId)?.armed,
    )
  const activeDescriptors = [
    ...new Map(selectedChannels.flatMap((c) => c.descriptors).map((d) => [d.id, d])).values(),
  ].filter((d) => !group?.parameters.length || group.parameters.includes(d.id))
  const consoleSections = visibleSections(w.hiddenSections).filter((s) =>
    activeDescriptors.some((d) => d.section === s),
  )
  const consoleSection = consoleSections.includes(section)
    ? section
    : (consoleSections[0] ?? section)
  const lastActivity = snapshot.activities[0]
  useEffect(() => {
    if (!initialized) {
      initialized = true
      void desk.initialize()
    }
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void desk.refresh()
    }, 5000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    if (
      selected &&
      !w.channels.some((c) => c.id === selected) &&
      !w.gangs.some((g) => g.id === selected)
    )
      setSelected(w.channels[0]?.id ?? '')
    setSelection((ids) => ids.filter((id) => w.channels.some((c) => c.id === id)))
    if (
      view !== 'all' &&
      view !== 'favorites' &&
      !w.gangs.some((g) => g.id === view) &&
      !w.devices.some((d) => d.id === view)
    )
      setView('all')
  }, [w.channels, w.gangs, w.devices, selected, view])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea, [role="dialog"]') || dialog) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (!readOnly) desk.undo()
      }
      if (e.key === 'Escape') {
        setMenu(false)
        setSidebar(false)
        if (!group) {
          setSelection([])
          setSelected('')
        }
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        document.getElementById('channel-search')?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dialog, readOnly, group])
  const selectView = (id: string) => {
    setView(id)
    setSidebar(false)
    if (w.gangs.some((g) => g.id === id)) {
      setSelected(id)
      setSelection([])
      setRelative(true)
    }
  }
  const toggleFavorite = (id: ParameterId) => {
    if (w.favorites.includes(id) && w.favorites.length > 1)
      desk.updateWorkspace({ favorites: w.favorites.filter((p) => p !== id) })
    else if (!w.favorites.includes(id) && w.favorites.length < 8)
      desk.updateWorkspace({ favorites: [...w.favorites, id] })
  }
  const reset = (ids: string[], s?: Section, mask?: ParameterId[]) => {
    setResetScope({ ids, section: s, mask })
    setDialog('reset')
  }
  const title =
    currentViewGang?.name ??
    w.devices.find((d) => d.id === view)?.label ??
    (view === 'favorites' ? 'Pinned controls' : 'All channels')
  return (
    <div className={`app ${w.density === 'compact' ? 'compact' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={25} strokeWidth={1.8} />
          </span>
          <span>
            Signal<span className="brand-light">Shade</span>
            <small>COLOR CONTROL DESK</small>
          </span>
        </div>
        <button className="workspace-switch" onClick={() => !readOnly && setDialog('workspace')}>
          <span className="workspace-dot" />
          <span>
            {w.name}
            <small>Workspace saved locally</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="topbar-right">
          <span className={`mode-pill ${simulated ? 'demo' : ''}`}>
            <span />
            {simulated === w.devices.length && simulated
              ? 'DEMO MODE'
              : simulated
                ? 'MIXED FLEET'
                : w.devices.length
                  ? 'LAN CONTROL'
                  : 'NO DEVICES'}
          </span>
          <button
            className={`icon-button ${globalLock ? 'text-warning' : ''}`}
            aria-label={globalLock ? 'Unlock desk' : 'Lock desk'}
            title={globalLock ? 'Unlock desk controls' : 'Lock desk controls'}
            onClick={() => setGlobalLock(!globalLock)}
          >
            {globalLock ? <Lock size={17} /> : <Unlock size={17} />}
          </button>
          <span className="topbar-divider" />
          <button
            className="avatar"
            aria-label="Help and keyboard shortcuts"
            onClick={() => setDialog('help')}
          >
            SS
          </button>
        </div>
      </header>
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="sidebar-top">
          <span className="eyebrow">WORKSPACE</span>
          <button
            className="icon-button tiny mobile-close"
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
          >
            <X size={16} />
          </button>
        </div>
        <nav aria-label="Workspace navigation">
          <button
            className={`nav-item ${view === 'all' ? 'active' : ''}`}
            onClick={() => selectView('all')}
          >
            <Grid2X2 size={17} />
            <span>All channels</span>
            <span className="nav-count">{w.channels.length}</span>
          </button>
          <button
            className={`nav-item ${view === 'favorites' ? 'active' : ''}`}
            onClick={() => selectView('favorites')}
          >
            <Star size={17} />
            <span>Pinned controls</span>
          </button>
        </nav>
        <div className="sidebar-heading">
          <span className="eyebrow">GANG GROUPS</span>
          <button
            className="icon-button tiny"
            aria-label="Create gang group"
            disabled={readOnly}
            onClick={() => {
              setEditGang(undefined)
              setDialog('gang')
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav aria-label="Gang groups">
          {w.gangs.map((g) => (
            <button
              className={`nav-item gang-nav ${view === g.id ? 'active' : ''}`}
              key={g.id}
              onClick={() => selectView(g.id)}
            >
              <span className="group-dot" style={{ background: g.color }} />
              <span>{g.name}</span>
              <span className="nav-count">{g.members.length.toString().padStart(2, '0')}</span>
            </button>
          ))}
          {!w.gangs.length && (
            <p className="sidebar-empty">Group channels for shared adjustments.</p>
          )}
        </nav>
        <div className="sidebar-heading">
          <span className="eyebrow">DEVICES</span>
          <button
            className="icon-button tiny"
            aria-label="Manage devices"
            onClick={() => setDialog('devices')}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav aria-label="Devices">
          {w.devices.map((d) => (
            <button
              className={`nav-item device-nav ${view === d.id ? 'active' : ''}`}
              key={d.id}
              onClick={() => selectView(d.id)}
            >
              <Server size={16} />
              <span>
                {d.label}
                <small>
                  {d.model} · {d.simulated ? 'Simulated' : new URL(d.address).hostname}
                </small>
              </span>
              <span className={`status-dot ${d.status !== 'online' ? 'offline' : ''}`} />
            </button>
          ))}
        </nav>
        <button className="add-device" onClick={() => setDialog('devices')}>
          <Plus size={15} />
          Connect a device
        </button>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setDialog('presets')}>
            <Layers3 size={17} />
            <span>Color presets</span>
            <span className="nav-count">{w.presets.length}</span>
          </button>
          <button className="nav-item" disabled={readOnly} onClick={() => setDialog('layout')}>
            <Settings2 size={17} />
            <span>Customize desk</span>
          </button>
          <div className="sidebar-footer">
            <span className="mini-logo">
              <AudioLines size={15} />
              SIGNALS, IN BALANCE.
            </span>
            <span>v0.1</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="main-heading">
          <div className="page-title">
            <button
              className="icon-button mobile-menu"
              aria-label="Open sidebar"
              onClick={() => setSidebar(!sidebar)}
            >
              <PanelLeftClose size={20} />
            </button>
            <div className="breadcrumb">
              WORKSPACE <ChevronRight size={11} /> {currentViewGang ? 'GANG GROUP' : 'OVERVIEW'}
            </div>
            <h1>
              {title}
              {currentViewGang && (
                <span className="title-dot" style={{ background: currentViewGang.color }} />
              )}
            </h1>
            <p>
              {currentViewGang
                ? 'Trim together. Keep the character of every source.'
                : 'Individual precision. Collective control.'}
            </p>
          </div>
          <div className="heading-actions">
            <button className="button" onClick={() => setDialog('presets')}>
              <Layers3 size={15} />
              Presets
            </button>
            <button className="button primary" onClick={() => setDialog('devices')}>
              <Plus size={16} />
              Add device
            </button>
          </div>
        </div>
        {update && (
          <div className="desk-alert" role="status">
            <RefreshCw size={15} />
            <span className="grow">A new SignalShade version is ready.</span>
            <button
              className="button small"
              disabled={snapshot.busy > 0}
              onClick={() => {
                navigator.serviceWorker.addEventListener(
                  'controllerchange',
                  () => location.reload(),
                  { once: true },
                )
                update.postMessage('ACTIVATE_UPDATE')
              }}
            >
              Load update
            </button>
          </div>
        )}
        {(snapshot.lockedTab || snapshot.storageError || globalLock) && (
          <div className="desk-alert" role="status">
            <Lock size={15} />
            {snapshot.lockedTab
              ? 'Read-only tab. Close the other control tab and reload to take control.'
              : globalLock
                ? 'Desk locked. Unlock in the top bar to make adjustments.'
                : snapshot.storageError}
          </div>
        )}
        {simulated > 0 && (
          <div className="demo-banner">
            <span className="demo-symbol">
              <Waves size={18} />
            </span>
            <span>
              <strong>
                {simulated === w.devices.length
                  ? 'Explore your desk.'
                  : 'Demo channels are present.'}
              </strong>{' '}
              {simulated === w.devices.length
                ? 'These channels are simulated. Try a trim, build a gang, make it yours.'
                : 'Simulated and hardware channels are clearly labeled.'}
            </span>
            <button onClick={() => setDialog('devices')}>
              Connect real hardware <ArrowRight size={14} />
            </button>
          </div>
        )}
        <div className="fleet-stats">
          <div>
            <span className="stat-icon">
              <Monitor size={17} />
            </span>
            <strong>{w.channels.length.toString().padStart(2, '0')}</strong>
            <span>channels</span>
          </div>
          <span className="stat-divider" />
          <div>
            <span className="stat-icon">
              <Server size={17} />
            </span>
            <strong>
              {online.toString().padStart(2, '0')}
              <small> / {w.devices.length.toString().padStart(2, '0')}</small>
            </strong>
            <span>devices connected</span>
          </div>
          <span className="stat-divider" />
          <div>
            <span className="stat-icon">
              <Layers3 size={17} />
            </span>
            <strong>{w.gangs.length.toString().padStart(2, '0')}</strong>
            <span>gang groups</span>
          </div>
          <div className="stats-right">
            <span className={`status-dot ${snapshot.busy ? 'pending' : ''}`} />
            {snapshot.busy ? `${snapshot.busy} pending` : 'Desk ready'}
            <button
              className="icon-button"
              aria-label="Refresh device values"
              disabled={readOnly || snapshot.busy > 0}
              onClick={() => void desk.refresh()}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <div className="channel-toolbar">
          <div className="search">
            <Search size={15} />
            <input
              id="channel-search"
              aria-label="Search channels"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a channel…"
            />
            <kbd>/</kbd>
          </div>
          <span className="channel-count">{channels.length} channels</span>
          <span className="selection-help">Ctrl/⌘-click or drag headers to select</span>
          <button className="button small" onClick={() => selectMany(channels.map((c) => c.id))}>
            Select visible
          </button>
          <label className="arrow-step">
            Arrow step
            <select
              aria-label="Arrow adjustment step"
              value={multiplier}
              onChange={(e) => setMultiplier(Number(e.target.value))}
            >
              <option value={1}>Fine</option>
              <option value={5}>Normal ×5</option>
              <option value={10}>Coarse ×10</option>
            </select>
          </label>
          <div className="toolbar-right">
            <select
              aria-label="Sort channels"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="custom">Custom order</option>
              <option value="name">Channel name</option>
              <option value="device">Device / processor</option>
            </select>
            <button
              className={`icon-button ${editLayout ? 'selected' : ''}`}
              disabled={readOnly}
              aria-label="Reorder and rename channels"
              title="Reorder and rename channels"
              onClick={() => setEditLayout(!editLayout)}
            >
              <SlidersHorizontal size={17} />
            </button>
            <div className="menu-container">
              <button
                className="icon-button"
                aria-label="Workspace actions"
                onClick={() => setMenu(!menu)}
              >
                <MoreHorizontal size={20} />
              </button>
              {menu && (
                <>
                  <button
                    className="menu-dismiss"
                    aria-label="Close workspace menu"
                    onClick={() => setMenu(false)}
                  />
                  <div className="dropdown-menu">
                    <button
                      onClick={() => {
                        downloadJson('signalshade-workspace.json', w)
                        setMenu(false)
                      }}
                    >
                      <Download size={15} />
                      Export workspace
                    </button>
                    <button
                      disabled={readOnly}
                      onClick={() => {
                        importRef.current?.click()
                        setMenu(false)
                      }}
                    >
                      <Upload size={15} />
                      Import workspace
                    </button>
                    <button
                      disabled={readOnly || snapshot.busy > 0}
                      onClick={() => {
                        setPendingWorkspace({ kind: 'empty' })
                        setMenu(false)
                      }}
                    >
                      <FolderOpen size={15} />
                      Start empty workspace
                    </button>
                    <button
                      disabled={readOnly || snapshot.busy > 0}
                      onClick={() => {
                        setPendingWorkspace({ kind: 'demo' })
                        setMenu(false)
                      }}
                    >
                      <Waves size={15} />
                      Load demo desk
                    </button>
                    <hr />
                    <button
                      disabled={readOnly || !w.channels.length}
                      onClick={() => {
                        reset(w.channels.map((c) => c.id))
                        setMenu(false)
                      }}
                    >
                      <RotateCcw size={15} />
                      Reset all channel colors
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <input
          hidden
          type="file"
          ref={importRef}
          accept="application/json,.json"
          aria-label="Import workspace file"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              if (file.size > 5_000_000) throw new Error('Workspace file must be smaller than 5 MB')
              const data = validateWorkspace(JSON.parse(await file.text()))
              setPendingWorkspace({ kind: 'import', data })
            } catch (e) {
              desk.log(`Import failed: ${message(e)}`, 'error')
              setActivity(true)
            }
          }}
        />
        {currentViewGang && (
          <div className="group-strip">
            <span className="group-dot" style={{ background: currentViewGang.color }} />
            <span>
              <strong>{currentViewGang.name}</strong> · {currentViewGang.members.length} members ·{' '}
              {currentViewGang.parameters.length
                ? `${currentViewGang.parameters.length} masked controls`
                : 'All compatible controls'}
            </span>
            <button
              className="button small"
              onClick={() => {
                setSelected(currentViewGang.id)
                setSelection([])
                setRelative(true)
              }}
            >
              <SlidersHorizontal size={13} />
              Group controls
            </button>
            <button
              className="icon-button"
              disabled={readOnly}
              aria-label="Edit selected gang"
              onClick={() => {
                setEditGang(currentViewGang)
                setDialog('gang')
              }}
            >
              <Edit3 size={14} />
            </button>
          </div>
        )}
        {batch && (
          <section className="inspector gang-console" aria-label="Gang and selection controls">
            <div className="inspector-heading">
              <span className="eyebrow">{group ? 'SAVED GANG' : 'TEMPORARY SELECTION'}</span>
              <div>
                {!group && (
                  <button
                    className="button small"
                    disabled={readOnly}
                    onClick={() => {
                      setEditGang(undefined)
                      setDialog('gang')
                    }}
                  >
                    <Plus size={13} />
                    Save as gang
                  </button>
                )}
                <button
                  className="button small"
                  onClick={() => {
                    setSelected('')
                    setSelection([])
                  }}
                >
                  Clear selection
                </button>
                <button
                  className="icon-button tiny"
                  disabled={readOnly || !targetIds.length}
                  aria-label="Reset selected colors"
                  onClick={() => reset(targetIds, undefined, group?.parameters)}
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  className="icon-button tiny"
                  aria-label="Save color preset"
                  onClick={() => setDialog('presets')}
                >
                  <Save size={15} />
                </button>
              </div>
            </div>
            <div className="inspector-identity">
              <div
                className={`inspector-icon ${group ? 'gang' : ''}`}
                style={group ? { color: group.color } : {}}
              >
                <Layers3 size={23} />
              </div>
              <div>
                <h2>{group?.name ?? `${selectedChannels.length} channels selected`}</h2>
                <p>
                  {group
                    ? `${selectedChannels.length} channels · explicit group controls`
                    : selectedChannel
                      ? `${w.devices.find((d) => d.id === selectedChannel.deviceId)?.label} · VID ${selectedChannel.processor}`
                      : 'Adjust this selection together · card controls remain individual'}
                </p>
              </div>
              {group && (
                <button
                  className="icon-button tiny"
                  disabled={readOnly}
                  aria-label="Edit gang"
                  onClick={() => {
                    setEditGang(group)
                    setDialog('gang')
                  }}
                >
                  <Edit3 size={14} />
                </button>
              )}
            </div>
            {!!targetIds.length && (
              <>
                <div className="inspector-state">
                  <span>
                    <span className={`status-dot ${controlsDisabled ? 'offline' : ''}`} />
                    {controlsDisabled
                      ? 'Controls locked'
                      : snapshot.busy && selectedChannels.some((c) => c.pending)
                        ? 'Confirming changes'
                        : 'Ready to adjust'}
                  </span>
                  <span>
                    {selectedChannels.every(
                      (c) => w.devices.find((d) => d.id === c.deviceId)?.simulated,
                    )
                      ? 'DEMO'
                      : 'HARDWARE'}
                  </span>
                </div>
                {batch && (
                  <>
                    <div className="segmented">
                      <button
                        className={relative ? 'active' : ''}
                        onClick={() => setRelative(true)}
                      >
                        Relative trim
                      </button>
                      <button
                        className={!relative ? 'active' : ''}
                        onClick={() => setRelative(false)}
                      >
                        Absolute set
                      </button>
                    </div>
                    <p className="mode-explanation">
                      {relative
                        ? 'Add to each member’s current value. Members clamp independently at their limits.'
                        : 'Set all compatible members to the same value. Each device enforces its own range.'}
                    </p>
                  </>
                )}
                <div className="detail-tabs" role="tablist" aria-label="Color control sections">
                  {consoleSections.map((s) => (
                    <button
                      role="tab"
                      aria-selected={consoleSection === s}
                      className={consoleSection === s ? 'active' : ''}
                      key={s}
                      onClick={() => setSection(s)}
                    >
                      {s === 'RGB correction' ? 'RGB' : s}
                    </button>
                  ))}
                </div>
                <div className="detail-scroll console-parameters">
                  <div className="detail-section-title">
                    <span>
                      {consoleSection === 'RGB correction'
                        ? 'RGB COLOR CORRECTION'
                        : consoleSection.toUpperCase()}
                    </span>
                    <button
                      className="icon-button tiny"
                      disabled={controlsDisabled}
                      aria-label={`Reset ${consoleSection} section`}
                      title={`Reset ${consoleSection}`}
                      onClick={() => reset(targetIds, consoleSection, group?.parameters)}
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                  {!activeDescriptors.some((d) => d.section === consoleSection) ? (
                    <div className="empty-small">
                      <SlidersHorizontal size={22} />
                      <p>No controls available in this section for the selected target.</p>
                    </div>
                  ) : (
                    <>
                      {activeDescriptors
                        .filter(
                          (d) =>
                            d.section === consoleSection &&
                            ['procEnabled', 'rgbEnabled'].includes(d.id),
                        )
                        .map((d) => (
                          <div className="enable-row" key={d.id}>
                            <span>
                              {d.label}
                              <small>
                                {commonValue(selectedChannels, d.id) === undefined
                                  ? 'Mixed enable states'
                                  : commonValue(selectedChannels, d.id)
                                    ? 'Processing enabled'
                                    : 'Processing bypassed'}
                              </small>
                            </span>
                            {d.kind === 'toggle' ? (
                              <button
                                className={`toggle ${commonValue(selectedChannels, d.id) ? 'on' : ''}`}
                                role="switch"
                                aria-label={`Enable ${d.label}`}
                                aria-checked={!!commonValue(selectedChannels, d.id)}
                                disabled={controlsDisabled || !isCompatible(selectedChannels, d.id)}
                                onClick={() =>
                                  desk.adjust(
                                    targetIds,
                                    d.id,
                                    commonValue(selectedChannels, d.id) ? 0 : 1,
                                    'absolute',
                                  )
                                }
                              >
                                <span />
                              </button>
                            ) : (
                              <select
                                aria-label={d.label}
                                disabled={controlsDisabled}
                                value={commonValue(selectedChannels, d.id) ?? ''}
                                onChange={(e) =>
                                  desk.adjust(targetIds, d.id, Number(e.target.value), 'absolute')
                                }
                              >
                                <option value="" disabled>
                                  Mixed
                                </option>
                                {d.choices?.map((o) => (
                                  <option value={o.value} key={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        ))}
                      {activeDescriptors
                        .filter(
                          (d) =>
                            d.section === consoleSection &&
                            !['procEnabled', 'rgbEnabled'].includes(d.id),
                        )
                        .map((d) => (
                          <ParameterControl
                            key={`${targetIds.join('|')}-${d.id}-${relative}`}
                            descriptor={d}
                            channels={selectedChannels}
                            relative={batch && relative && d.kind === 'number'}
                            disabled={controlsDisabled}
                            multiplier={multiplier}
                            favorite={w.favorites.includes(d.id)}
                            toggleFavorite={readOnly ? undefined : () => toggleFavorite(d.id)}
                          />
                        ))}
                    </>
                  )}
                  {batch && (
                    <div className="member-summary">
                      <div className="section-heading">
                        <span>GROUP MEMBERS</span>
                        <span>{selectedChannels.length}</span>
                      </div>
                      {selectedChannels.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            selectChannel(c.id)
                          }}
                        >
                          <span className="status-dot" />
                          <span>{c.label}</span>
                          <ChevronRight size={13} />
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedChannel && (
                    <div className="channel-meta">
                      <span>
                        INPUT ASSIGNMENT<strong>{selectedChannel.source}</strong>
                      </span>
                      <span>
                        VIDEO FORMAT<strong>{selectedChannel.format}</strong>
                      </span>
                      <span>
                        READBACK
                        <strong>
                          {selectedChannel.updatedAt
                            ? new Date(selectedChannel.updatedAt).toLocaleTimeString()
                            : 'Stale / not connected'}
                        </strong>
                      </span>
                      {selectedChannel.issue && (
                        <p className="text-error">{selectedChannel.issue}</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="inspector-footer">
                  <span>ADJUSTMENT STEP</span>
                  <div className="step-buttons">
                    {[
                      { n: 1, label: 'Fine' },
                      { n: 5, label: 'Normal' },
                      { n: 10, label: 'Coarse' },
                    ].map((x) => (
                      <button
                        key={x.n}
                        className={multiplier === x.n ? 'active' : ''}
                        onClick={() => setMultiplier(x.n)}
                      >
                        {x.label}
                      </button>
                    ))}
                  </div>
                  <p>
                    <Radio size={11} /> Changes apply live · readback verified
                  </p>
                </div>
              </>
            )}
          </section>
        )}
        <div
          className={`channel-grid ${view === 'favorites' ? 'pins-view' : ''}`}
          {...gridSelectionHandlers}
        >
          {channels.map((c, index) => (
            <ChannelCard
              key={c.id}
              channel={c}
              index={index}
              workspace={w}
              selected={(preview ?? targetIds).includes(c.id)}
              gangSelected={!!group?.members.includes(c.id)}
              edit={editLayout}
              disabled={readOnly}
              onSelect={(e) => selectChannel(c.id, e.ctrlKey || e.metaKey)}
              multiplier={multiplier}
              onReset={(section) => reset([c.id], section)}
            />
          ))}
          <button className="add-channel-card" onClick={() => setDialog('devices')}>
            <span>
              <Plus size={23} />
            </span>
            <strong>Add a device</strong>
            <small>Bring another source into balance</small>
          </button>
        </div>
        {!channels.length && query && (
          <div className="empty-small">
            <Search size={24} />
            <p>No channels match “{query}”.</p>
          </div>
        )}
        <div className="main-bottom-note">
          <span>
            <span className="status-dot" />
            {simulated
              ? 'Simulated values · safe to explore'
              : 'Values confirmed by device readback'}
          </span>
          <span>
            Labels stay with processor channels <CircleHelp size={12} />
          </span>
        </div>
      </main>

      {rectangle && (
        <div
          className="selection-marquee"
          aria-hidden="true"
          style={{
            left: rectangle.left,
            top: rectangle.top,
            width: rectangle.right - rectangle.left,
            height: rectangle.bottom - rectangle.top,
          }}
        />
      )}
      <footer className="statusbar">
        <button className={activity ? 'active' : ''} onClick={() => setActivity(!activity)}>
          <Activity size={14} />
          <span>Activity</span>
          <span className="activity-count">{snapshot.activities.length}</span>
          <ChevronDown size={12} className={activity ? 'flip' : ''} />
        </button>
        <span className={`last-action ${lastActivity?.type === 'error' ? 'text-error' : ''}`}>
          {lastActivity?.text ?? 'Starting desk…'}
        </span>
        <div className="statusbar-right">
          <button
            disabled={readOnly || !snapshot.history.length || snapshot.busy > 0}
            title="Undo last adjustment (Ctrl/Cmd+Z)"
            onClick={() => desk.undo()}
          >
            <RotateCcw size={13} />
            Undo
          </button>
          <span className="statusbar-separator" />
          <span>
            <Network size={12} />
            LOCAL CONTROL
          </span>
          <span className="statusbar-version">SIGNALSHADE / 0.1.0</span>
        </div>
      </footer>
      {activity && (
        <section className="activity-panel" aria-label="Activity log">
          <div className="section-heading">
            <span>ACTIVITY · {snapshot.activities.length} RECENT EVENTS</span>
            <button
              className="icon-button"
              aria-label="Close activity"
              onClick={() => setActivity(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div>
            {snapshot.activities.map((a) => (
              <div className={`activity-row ${a.type}`} key={a.id}>
                <time>{new Date(a.at).toLocaleTimeString()}</time>
                {a.type === 'success' ? <Check size={12} /> : <span className="status-dot" />}
                <p>{a.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      {dialog === 'devices' && <DeviceDialog workspace={w} close={close} readOnly={readOnly} />}
      {dialog === 'gang' && (
        <GangDialog workspace={w} gang={editGang} initialMembers={targetIds} close={close} />
      )}
      {dialog === 'presets' && (
        <PresetDialog workspace={w} targetIds={targetIds} close={close} readOnly={readOnly} />
      )}
      {dialog === 'layout' && <LayoutDialog workspace={w} close={close} />}
      {dialog === 'reset' && (
        <ResetDialog
          workspace={w}
          ids={resetScope.ids}
          section={resetScope.section}
          mask={resetScope.mask}
          close={close}
        />
      )}
      {dialog === 'workspace' && <WorkspaceDialog workspace={w} close={close} />}
      {dialog === 'help' && (
        <Modal
          title="A desk for every source"
          subtitle="SignalShade · Individual precision. Collective control."
          close={close}
        >
          <div className="help-content">
            <h3>Start with the demo</h3>
            <p>
              Use the Quick tab for your chosen controls. Open Proc amp, RGB, or Legalizer on a card
              for the full section. Restore default layout in Customize desk if controls are hidden.
              All demo devices are simulated and generate no network traffic.
            </p>
            <h3>Trim together</h3>
            <p>
              Ctrl/⌘-click channel headers to toggle a selection, or drag from a header or empty
              grid space to select multiple cards. Ctrl/⌘-drag adds to the selection; Escape clears
              it. Open a saved gang from the sidebar or save your selection as a gang. Relative trim
              adds to each member’s existing values. Absolute set gives every member the same value,
              within device limits. Single-channel edits always stay local.
            </p>
            <h3>Connect your fleet</h3>
            <p>
              Add device → Test connection → review mappings → add read-only. Enable writes
              explicitly for an off-air test. Hardware support is experimental until your model and
              firmware pass qualification.
            </p>
            <h3>Protect your setup</h3>
            <p>
              Export a workspace backup from the ⋯ menu. Imported workspaces never send commands
              automatically. Hardware credentials are kept in session memory only.
            </p>
            <div className="shortcut-row">
              <kbd>/</kbd>
              <span>Find a channel</span>
              <kbd>Ctrl / ⌘ Z</kbd>
              <span>Undo last adjustment</span>
            </div>
            <a
              className="text-link"
              href="https://github.com/InertiaImpact/SignalShade"
              target="_blank"
              rel="noreferrer"
            >
              Documentation & source <ArrowRight size={13} />
            </a>
          </div>
        </Modal>
      )}
      {pendingWorkspace && (
        <ConfirmWorkspace
          kind={pendingWorkspace.kind}
          close={() => setPendingWorkspace(undefined)}
          confirm={() => {
            void desk
              .replaceWorkspace(pendingWorkspace.data, pendingWorkspace.kind)
              .then(() => {
                setPendingWorkspace(undefined)
                setSelected('')
                setSelection([])
                setView('all')
              })
              .catch((e) => desk.log(message(e), 'error'))
          }}
        />
      )}
    </div>
  )
}

function ChannelCard({
  channel: c,
  index,
  workspace: w,
  selected,
  gangSelected,
  edit,
  disabled,
  onSelect,
  onReset,
  multiplier,
}: {
  channel: Channel
  index: number
  workspace: ReturnType<typeof desk.getSnapshot>['workspace']
  selected: boolean
  gangSelected: boolean
  edit: boolean
  disabled: boolean
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void
  multiplier: number
  onReset: (section?: Section) => void
}) {
  const device = w.devices.find((d) => d.id === c.deviceId)!
  const [label, setLabel] = useState(c.label),
    [renaming, setRenaming] = useState(false)
  const [controlTab, setControlTab] = useState<Section | 'quick'>('quick')
  const cardSections = visibleSections(w.hiddenSections).filter((section) =>
    c.descriptors.some((d) => d.section === section),
  )
  const activeTab =
    controlTab === 'quick' || !cardSections.includes(controlTab) ? 'quick' : controlTab
  const descriptors =
    activeTab === 'quick'
      ? quickControls(c, w.favorites)
      : c.descriptors.filter((d) => d.section === activeTab)
  const blocked =
    disabled || c.locked || !device.armed || device.status !== 'online' || !!c.issue || !c.updatedAt
  const groups = w.gangs.filter((g) => g.members.includes(c.id))
  return (
    <article
      className={`channel-card ${selected ? 'selected' : ''} ${gangSelected ? 'gang-member' : ''} ${c.locked ? 'locked' : ''}`}
      aria-label={`${c.label} channel`}
      data-channel-id={c.id}
    >
      <div className="card-heading">
        <button
          className="card-select"
          aria-label={`Select ${c.label}`}
          aria-pressed={selected}
          onClick={onSelect}
        >
          <span className="channel-number">
            {selected ? <Check size={14} /> : (index + 1).toString().padStart(2, '0')}
          </span>
          <span>
            <strong>{c.label}</strong>
            <small>
              {device.label} <span>·</span> VID {c.processor} <span>·</span> {c.source}
            </small>
          </span>
        </button>
        <span
          className="card-state"
          title={`${c.source} · ${c.format} · ${c.updatedAt ? 'Read ' + new Date(c.updatedAt).toLocaleTimeString() : 'No readback'}`}
        >
          <span
            className={`status-dot ${device.status !== 'online' || c.issue ? 'offline' : c.pending ? 'pending' : ''}`}
          />
          {device.simulated
            ? 'DEMO'
            : c.issue
              ? 'UNVERIFIED'
              : device.status !== 'online'
                ? 'OFFLINE'
                : c.pending
                  ? 'PENDING'
                  : !device.armed
                    ? 'READ ONLY'
                    : 'LIVE'}
        </span>
        <button
          className="icon-button tiny"
          disabled={disabled}
          aria-label={`${c.locked ? 'Unlock' : 'Lock'} ${c.label}`}
          onClick={() => desk.updateChannel(c.id, { locked: !c.locked })}
        >
          {c.locked ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
      </div>
      {edit && (
        <div className="card-edit">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (label.trim()) {
                  desk.updateChannel(c.id, { label: label.trim() })
                  setRenaming(false)
                }
              }}
            >
              <input
                aria-label={`New label for ${c.label}`}
                value={label}
                maxLength={100}
                onChange={(e) => setLabel(e.target.value)}
              />
              <button className="icon-button tiny" aria-label="Save channel label">
                <Check size={13} />
              </button>
            </form>
          ) : (
            <button
              className="button small"
              onClick={() => {
                setLabel(c.label)
                setRenaming(true)
              }}
            >
              <Edit3 size={12} />
              Rename
            </button>
          )}
          <button
            className="icon-button tiny"
            aria-label={`Move ${c.label} earlier`}
            onClick={() => desk.reorderChannel(c.id, -1)}
          >
            <ArrowUp size={13} />
          </button>
          <button
            className="icon-button tiny"
            aria-label={`Move ${c.label} later`}
            onClick={() => desk.reorderChannel(c.id, 1)}
          >
            <ArrowDown size={13} />
          </button>
        </div>
      )}
      <div className="card-control-tabs" role="tablist" aria-label={`Controls for ${c.label}`}>
        {(['quick', ...cardSections] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setControlTab(tab)}
          >
            {tab === 'quick' ? 'Quick' : tab === 'RGB correction' ? 'RGB' : tab}
          </button>
        ))}
        {activeTab !== 'quick' && (
          <button
            className="icon-button tiny section-reset"
            disabled={blocked}
            aria-label={`Reset ${activeTab} for ${c.label}`}
            title="Reset section"
            onClick={() => onReset(activeTab)}
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      <div
        className="card-parameters"
        role="tabpanel"
        aria-label={`${activeTab === 'quick' ? 'Quick' : activeTab} controls for ${c.label}`}
      >
        {descriptors.map((d) => (
          <ParameterControl
            key={d.id}
            descriptor={d}
            channels={[c]}
            relative={false}
            disabled={blocked}
            multiplier={multiplier}
            compact
          />
        ))}
        {!descriptors.length && (
          <div className="card-controls-empty">
            <p>No supported color controls on this channel.</p>
          </div>
        )}
      </div>
      <div className="card-bottom">
        <span className="group-tags">
          {groups.slice(0, 2).map((g) => (
            <button key={g.id} title={g.name} onClick={onSelect}>
              <span className="group-dot" style={{ background: g.color }} />
              {g.name}
            </button>
          ))}
          {groups.length > 2 && <small>+{groups.length - 2}</small>}
          {!groups.length && <span className="ungrouped">Independent</span>}
        </span>
        <button
          className="icon-button tiny"
          aria-label={`Reset ${c.label} colors`}
          title="Reset channel colors"
          disabled={blocked}
          onClick={() => onReset()}
        >
          <RotateCcw size={12} />
        </button>
      </div>
      {selected && <span className="selected-marker" />}
      {c.issue && <p className="card-issue">{c.issue}</p>}
    </article>
  )
}
