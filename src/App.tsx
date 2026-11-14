import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Activity,
  ArrowRight,
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
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Star,
  Target,
  Unlock,
  Upload,
  X,
} from 'lucide-react'
import { desk } from './core/store'
import { getWaitingUpdate, subscribeUpdates } from './core/updates'
import type { Channel, Gang, ParameterId, ParameterMasks, Section } from './core/types'
import { downloadJson, validateWorkspace } from './core/persistence'
import { message } from './adapters/aja'
import { ParameterControl } from './components/ParameterControl'
import { GangControls } from './components/GangControls'
import { GangCard } from './components/GangCard'
import { DeviceDialog } from './components/DeviceDialog'
import { RecorderStrip } from './components/RecorderStrip'
import { RecorderOverview } from './components/RecorderOverview'
import { DemoIndicator } from './components/DemoIndicator'
import { QuickStageControls } from './components/QuickStageControls'
import { ViewDialog } from './components/ViewDialog'
import { useCardOrder } from './components/useCardOrder'
import { cardsInView, customViewKey, deviceViewKey, gangViewKey } from './core/views'
import { ConvergeControls } from './components/ConvergeControls'
import {
  GangDialog,
  LayoutDialog,
  PresetDialog,
  ResetDialog,
  WorkspaceDialog,
} from './components/WorkspaceDialogs'
import { Modal } from './components/Modal'

import { useChannelSelection } from './components/useChannelSelection'
import {
  quickControls,
  quickStages,
  visibleControlSections as visibleSections,
  gangDescriptors,
  rgbControls,
  availableRgbFamilies,
  type RgbFamily,
} from './core/layout'
import { RgbTabs } from './components/RgbTabs'
import { resolveSelection, toggleSelection } from './core/selection'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'

type Dialog =
  | 'devices'
  | 'recorders'
  | 'gang'
  | 'presets'
  | 'layout'
  | 'reset'
  | 'workspace'
  | 'new-workspace'
  | 'view'
  | 'help'
  | null
let initialized = false
export default function App() {
  const snapshot = useSyncExternalStore(desk.subscribe, desk.getSnapshot),
    { workspace: w } = snapshot
  const [view, setView] = useState('all'),
    [selected, setSelected] = useState(''),
    [selection, setSelection] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('custom'),
    [dialog, setDialog] = useState<Dialog>(null)
  const [deviceSelection, setDeviceSelection] = useState<string>()
  const openDevices = (id?: string) => {
    setDeviceSelection(id)
    setDialog('devices')
  }
  const [viewEditorId, setViewEditorId] = useState<string>()
  const [editGang, setEditGang] = useState<Gang>(),
    [resetScope, setResetScope] = useState<{
      ids: string[]
      section?: Section
      mask?: ParameterId[]
      masks?: ParameterMasks
    }>({ ids: [] }),
    [relative, setRelative] = useState(true),
    [multiplier, setMultiplier] = useState(1)
  const [activity, setActivity] = useState(false),
    [editLayout, setEditLayout] = useState(false),
    [menu, setMenu] = useState(false),
    [workspaceMenu, setWorkspaceMenu] = useState(false),
    [collapsed, setCollapsed] = useState(() => {
      try {
        return localStorage.getItem('signalshade-sidebar-collapsed') === 'true'
      } catch {
        return false
      }
    }),
    [sidebar, setSidebar] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const globalLock = snapshot.controlsLocked
  const update = useSyncExternalStore(subscribeUpdates, getWaitingUpdate)
  const recorderStates = useSyncExternalStore(desk.recorders.subscribe, desk.recorders.getSnapshot)
  const recorderBusy = Object.values(recorderStates).some((s) => s.pending)
  const close = () => setDialog(null)
  const selectedTokens = selection.length ? selection : selected ? [selected] : []
  const group =
    selectedTokens.length === 1 ? w.gangs.find((g) => g.id === selectedTokens[0]) : undefined
  const selectedChannel =
    selectedTokens.length === 1 ? w.channels.find((c) => c.id === selectedTokens[0]) : undefined
  const resolved = resolveSelection(w, selectedTokens)
  const selectedChannels = resolved.channels
  const convergeTarget = w.channels.find((c) => c.id === w.convergeTargetId)
  const targetIds = selectedChannels.map((c) => c.id)
  const batch = !!group || selectedChannels.length > 1
  const selectMany = (ids: string[]) => {
    setSelection(ids)
    setSelected('')
    setRelative(true)
  }
  const selectChannel = (id: string, additive = false) => {
    if (additive) selectMany(toggleSelection(selectedTokens, id))
    else {
      setSelection([])
      setSelected(id)
      setRelative(w.gangs.some((g) => g.id === id))
    }
  }
  const clearSelection = () => {
    setSelected('')
    setSelection([])
  }
  const selectionGesture = useChannelSelection(selectedTokens, selectMany, selectChannel)
  const { rectangle, preview, ...paneSelectionHandlers } = selectionGesture
  const currentViewGang = w.gangs.find((g) => gangViewKey(g.id) === view)
  const currentCustomView = w.views?.find((item) => customViewKey(item.id) === view)
  const currentDevice = w.devices.find((d) => deviceViewKey(d.id) === view)
  const cardOrder = cardsInView(w, view)
  const channels = useMemo(() => {
    let list = w.channels.filter((c) =>
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
  }, [w, query, sort])
  const connectionCount = w.devices.length + (w.recorders?.length ?? 0)
  const simulated =
      w.devices.filter((d) => d.simulated).length +
      (w.recorders ?? []).filter((c) => c.simulated).length,
    online =
      w.devices.filter((d) => d.status === 'online').length +
      Object.values(recorderStates).filter((s) => s.updatedAt && s.state !== 'offline').length
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
  const activeDescriptors = gangDescriptors(
    selectedChannels.map((c) => ({
      ...c,
      descriptors: c.descriptors.filter(
        (d) => !resolved.masks[c.id]?.length || resolved.masks[c.id]!.includes(d.id),
      ),
    })),
  )
  const previewIds = resolveSelection(w, preview ?? selectedTokens).channels.map((c) => c.id)
  const visibleChannelIds = new Set(channels.map((channel) => channel.id))
  const shownGangCards = w.gangs.filter((g) => g.name.toLowerCase().includes(query.toLowerCase()))
  const visibleGangIds = new Set(shownGangCards.map((g) => g.id))
  const visibleCards = cardOrder.filter((id) => visibleChannelIds.has(id) || visibleGangIds.has(id))
  const visibleChannels = channels.filter((channel) => visibleCards.includes(channel.id))
  const sortedChannels = [...visibleChannels]
  const orderedCards =
    sort === 'custom'
      ? visibleCards
      : visibleCards.map((id) => (visibleGangIds.has(id) ? id : sortedChannels.shift()!.id))
  const reorder = useCardOrder(
    orderedCards,
    !readOnly && sort === 'custom' && !query.trim(),
    (id, target) => desk.moveViewCard(view, id, target),
  )
  const consoleSections = visibleSections(w.hiddenSections).filter((s) =>
    activeDescriptors.some((d) => d.section === s),
  )
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
      setSelected('')
    setSelection((ids) =>
      ids.filter((id) => w.channels.some((c) => c.id === id) || w.gangs.some((g) => g.id === id)),
    )
    if (
      view !== 'all' &&
      view !== 'favorites' &&
      !currentViewGang &&
      !currentDevice &&
      !currentCustomView
    )
      setView('all')
  }, [w.channels, w.gangs, selected, view, currentViewGang, currentDevice, currentCustomView])
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
        setWorkspaceMenu(false)
        setSidebar(false)
        clearSelection()
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
    setQuery('')
    setSort('custom')
    clearSelection()
  }
  const changeWorkspace = async (change: () => Promise<void>) => {
    try {
      await change()
      selectView('all')
      close()
      setWorkspaceMenu(false)
    } catch (error) {
      desk.log(message(error), 'error')
      setActivity(true)
    }
  }
  const toggleCollapsed = () => {
    setCollapsed(!collapsed)
    try {
      localStorage.setItem('signalshade-sidebar-collapsed', String(!collapsed))
    } catch {
      // The sidebar still works when browser storage is unavailable.
    }
  }
  const toggleFavorite = (id: ParameterId) => {
    if (w.favorites.includes(id) && w.favorites.length > 1)
      desk.updateWorkspace({ favorites: w.favorites.filter((p) => p !== id) })
    else if (!w.favorites.includes(id) && w.favorites.length < 8)
      desk.updateWorkspace({ favorites: [...w.favorites, id] })
  }
  const reset = (ids: string[], s?: Section, mask?: ParameterId[], masks?: ParameterMasks) => {
    setResetScope({ ids, section: s, mask, masks })
    setDialog('reset')
  }
  const title =
    currentViewGang?.name ??
    currentCustomView?.name ??
    currentDevice?.label ??
    (view === 'favorites' ? 'Pinned controls' : 'All channels')
  return (
    <div
      className={`app ${w.density === 'compact' ? 'compact' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}
    >
      <div className="header-area">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <AudioLines size={25} strokeWidth={1.8} />
            </span>
            <span>
              Signal<span className="brand-light">Shade</span>
            </span>
          </div>
          <div className="menu-container workspace-picker">
            <button
              className="workspace-switch"
              aria-label={`Workspaces · ${w.name}`}
              aria-expanded={workspaceMenu}
              onClick={() => setWorkspaceMenu(!workspaceMenu)}
            >
              <span className="workspace-dot" />
              <span>{w.name}</span>
              <ChevronDown size={15} />
            </button>
            {workspaceMenu && (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="Close workspace menu"
                  onClick={() => setWorkspaceMenu(false)}
                />
                <div className="dropdown-menu workspace-menu">
                  {snapshot.workspaces.map(({ id, name }) => (
                    <button
                      key={id}
                      aria-current={id === snapshot.workspaceId ? 'true' : undefined}
                      disabled={
                        id !== snapshot.workspaceId &&
                        (readOnly || snapshot.busy > 0 || recorderBusy)
                      }
                      onClick={() =>
                        id === snapshot.workspaceId
                          ? setWorkspaceMenu(false)
                          : void changeWorkspace(() => desk.switchWorkspace(id))
                      }
                    >
                      {id === snapshot.workspaceId ? <Check size={15} /> : <FolderOpen size={15} />}
                      {name}
                    </button>
                  ))}
                  <hr />
                  <button
                    disabled={readOnly || snapshot.busy > 0 || recorderBusy}
                    onClick={() => {
                      setWorkspaceMenu(false)
                      setDialog('new-workspace')
                    }}
                  >
                    <Plus size={15} /> New workspace
                  </button>
                  <button
                    disabled={readOnly}
                    onClick={() => {
                      setWorkspaceMenu(false)
                      setDialog('workspace')
                    }}
                  >
                    <Edit3 size={15} /> Rename workspace
                  </button>
                  <button
                    disabled={readOnly || snapshot.busy > 0 || recorderBusy}
                    onClick={() => {
                      setWorkspaceMenu(false)
                      importRef.current?.click()
                    }}
                  >
                    <Upload size={15} /> Import as workspace
                  </button>
                  <button
                    onClick={() => {
                      downloadJson('signalshade-workspace.json', w)
                      setWorkspaceMenu(false)
                    }}
                  >
                    <Download size={15} /> Export workspace
                  </button>
                </div>
              </>
            )}
          </div>
          <RecorderStrip
            configs={w.recorders ?? []}
            readOnly={readOnly}
            manage={openDevices}
            openOverview={() => setDialog('recorders')}
          />
          <div className="topbar-right">
            <button
              className="connection-summary"
              aria-label="Manage connections"
              title={`${online} of ${connectionCount} devices connected · ${simulated} simulated`}
              onClick={() => openDevices()}
            >
              <span className={`status-dot ${online < connectionCount ? 'offline' : ''}`} />
              <span>
                {online}/{connectionCount} <span className="connection-label">devices</span>
              </span>
              <ChevronDown size={13} />
            </button>
            <button
              className="icon-button header-refresh"
              aria-label="Refresh device values"
              title="Refresh device values"
              disabled={readOnly || snapshot.busy > 0}
              onClick={() => void desk.refresh()}
            >
              <RefreshCw size={15} className={snapshot.busy ? 'spin' : ''} />
            </button>
            <DemoIndicator simulated={simulated} total={connectionCount} />
            <button
              className={`icon-button ${globalLock ? 'text-warning' : ''}`}
              aria-label={globalLock ? 'Unlock desk' : 'Lock desk'}
              title={globalLock ? 'Unlock desk controls' : 'Lock desk controls'}
              onClick={() => desk.setControlsLocked(!globalLock)}
            >
              {globalLock ? <Lock size={17} /> : <Unlock size={17} />}
            </button>
            <span className="topbar-divider" />
            <button
              className={`icon-button activity-toggle ${lastActivity?.type === 'error' ? 'text-error' : ''}`}
              aria-label="Activity log"
              aria-expanded={activity}
              title={lastActivity?.text ?? 'Activity log'}
              onClick={() => setActivity(!activity)}
            >
              <Activity size={16} />
            </button>
            <button
              className="avatar"
              aria-label="Help and keyboard shortcuts"
              onClick={() => setDialog('help')}
            >
              <CircleHelp size={17} />
            </button>
          </div>
        </header>
      </div>
      <aside id="desk-sidebar" className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="sidebar-top">
          <span className="eyebrow">VIEWS</span>
          <button
            className="icon-button tiny"
            aria-label="Create view"
            disabled={readOnly}
            onClick={() => {
              setViewEditorId(undefined)
              setDialog('view')
            }}
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-button tiny mobile-close"
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
          >
            <X size={16} />
          </button>
        </div>
        <nav aria-label="Views">
          <button
            className={`nav-item ${view === 'all' ? 'active' : ''}`}
            onClick={() => selectView('all')}
          >
            <Grid2X2 size={17} />
            <span>All channels</span>
            <span className="nav-count">{w.channels.length}</span>
          </button>
          {w.views?.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === customViewKey(item.id) ? 'active' : ''}`}
              onClick={() => selectView(customViewKey(item.id))}
            >
              <Grid2X2 size={17} />
              <span>{item.name}</span>
            </button>
          ))}
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
            <div className="gang-nav-row" key={g.id}>
              <button
                className={`nav-item gang-nav ${view === gangViewKey(g.id) ? 'active' : ''}`}
                aria-pressed={selectedTokens.includes(g.id)}
                onClick={(e) =>
                  e.ctrlKey || e.metaKey ? selectChannel(g.id, true) : selectView(gangViewKey(g.id))
                }
              >
                <span className="group-dot" style={{ background: g.color }} />
                <span>{g.name}</span>
                <span className="nav-count">{g.members.length.toString().padStart(2, '0')}</span>
              </button>
              <button
                className="gang-card-toggle"
                role="switch"
                aria-checked={!!g.showAsCard}
                aria-label={`Show ${g.name} as a card in All channels`}
                title={`Show ${g.name} as a card in All channels`}
                disabled={readOnly}
                style={{ '--gang-color': g.color } as CSSProperties}
                onClick={() => desk.showGangCard(g.id, !g.showAsCard)}
              >
                <span />
              </button>
            </div>
          ))}
          {!w.gangs.length && (
            <p className="sidebar-empty">Group channels for shared adjustments.</p>
          )}
        </nav>
        <div className="sidebar-heading">
          <span className="eyebrow">CHANNELS BY DEVICE</span>
        </div>
        <nav aria-label="Channels by device">
          {w.devices.map((d) => (
            <button
              className={`nav-item device-nav ${view === deviceViewKey(d.id) ? 'active' : ''}`}
              key={d.id}
              aria-current={view === deviceViewKey(d.id) ? 'page' : undefined}
              title={`Show channels on ${d.label}`}
              onClick={() => selectView(deviceViewKey(d.id))}
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
        <button
          className="add-device"
          onClick={() => {
            setSidebar(false)
            openDevices()
          }}
        >
          <Settings2 size={15} />
          Manage devices
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
        </div>
      </aside>
      <main className="main" {...paneSelectionHandlers}>
        <div className="main-heading">
          <button
            className="icon-button mobile-menu"
            aria-label={sidebar ? 'Close navigation' : 'Open navigation'}
            aria-controls="desk-sidebar"
            aria-expanded={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            <PanelLeftOpen size={19} />
          </button>
          <button
            className="icon-button desktop-sidebar-toggle"
            aria-controls="desk-sidebar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <h1>
            {title}
            <span className="view-count">{visibleChannels.length}</span>
          </h1>
          {(currentCustomView || currentViewGang) && (
            <button
              className="icon-button"
              aria-label={currentCustomView ? 'Edit view' : 'Edit gang group'}
              disabled={readOnly}
              onClick={() => {
                if (currentCustomView) {
                  setViewEditorId(currentCustomView.id)
                  setDialog('view')
                } else {
                  setEditGang(currentViewGang)
                  setDialog('gang')
                }
              }}
            >
              <Edit3 size={15} />
            </button>
          )}
          <div className="channel-toolbar">
            <div className="search">
              <Search size={15} />
              <input
                id="channel-search"
                aria-label="Search channels"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search channels"
              />
              <kbd>/</kbd>
            </div>
            <button
              className="button small"
              title="Select visible channels · Ctrl/⌘-click or drag headers for a partial selection"
              disabled={!visibleChannels.length}
              onClick={() => selectMany(visibleChannels.map((c) => c.id))}
            >
              Select visible
            </button>
            <div className="arrow-step">
              <span>Step</span>
              <div className="segmented" role="group" aria-label="Arrow adjustment step">
                {(
                  [
                    ['Fine', 1],
                    ['Normal', 5],
                    ['Coarse', 10],
                  ] as const
                ).map(([label, step]) => (
                  <button
                    key={step}
                    className={multiplier === step ? 'active' : ''}
                    aria-pressed={multiplier === step}
                    title={`${label} · ×${step}`}
                    onClick={() => setMultiplier(step)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="toolbar-right">
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
                      aria-label="Close channel menu"
                      onClick={() => setMenu(false)}
                    />
                    <div className="dropdown-menu">
                      <label className="menu-field">
                        Channel order
                        <select
                          aria-label="Sort channels"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="custom">Custom order</option>
                          <option value="name">Channel name</option>
                          <option value="device">Device / processor</option>
                        </select>
                      </label>
                      <button
                        disabled={readOnly || !snapshot.history.length || snapshot.busy > 0}
                        onClick={() => {
                          desk.undo()
                          setMenu(false)
                        }}
                      >
                        <RotateCcw size={15} /> Undo last adjustment
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
          <div className="main-heading-actions">
            <span
              className={`target-summary ${convergeTarget ? 'has-target' : ''}`}
              title={
                convergeTarget
                  ? 'Converge leaves this camera unchanged'
                  : 'Converge uses the group median'
              }
            >
              <Target size={14} />
              {convergeTarget ? convergeTarget.label : 'Median target'}
            </span>
            <button
              className="button small"
              disabled={readOnly || snapshot.converging || snapshot.busy > 0 || !convergeTarget}
              onClick={() => desk.setConvergeTarget()}
            >
              Clear target
            </button>
            <button className="button small" disabled={!targetIds.length} onClick={clearSelection}>
              Clear selection
            </button>
          </div>
        </div>
        {update && (
          <div className="desk-alert" role="status">
            <RefreshCw size={15} />
            <span className="grow">A new SignalShade version is ready.</span>
            <button
              className="button small"
              disabled={snapshot.busy > 0 || recorderBusy}
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
              await changeWorkspace(() => desk.addWorkspace(data, 'import'))
            } catch (e) {
              desk.log(`Import failed: ${message(e)}`, 'error')
              setActivity(true)
            }
          }}
        />
        {batch && (
          <section
            className="inspector gang-console"
            aria-label="Gang and selection controls"
            style={{ '--gang-color': group?.color ?? 'var(--accent)' } as CSSProperties}
          >
            <div className="inspector-heading">
              <div className="console-title">
                <Layers3 size={17} />
                <h2>{group?.name ?? `${selectedChannels.length} selected`}</h2>
                {group && <span>{selectedChannels.length}</span>}
                <span
                  className={`status-dot ${controlsDisabled ? 'offline' : ''}`}
                  title={controlsDisabled ? 'Controls locked' : 'Ready to adjust'}
                />
              </div>
              <div>
                {group && (
                  <button
                    className="icon-button tiny"
                    disabled={readOnly}
                    aria-label="Edit gang"
                    title="Edit gang"
                    onClick={() => {
                      setEditGang(group)
                      setDialog('gang')
                    }}
                  >
                    <Edit3 size={15} />
                  </button>
                )}
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
                  className="icon-button tiny"
                  disabled={readOnly || !targetIds.length}
                  aria-label="Reset selected colors"
                  onClick={() => reset(targetIds, undefined, undefined, resolved.masks)}
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
            {!!targetIds.length && (
              <>
                {batch && (
                  <>
                    <div className="batch-action-row">
                      <div className="segmented">
                        <button
                          className={relative ? 'active' : ''}
                          aria-pressed={relative}
                          title="Add to each member’s current value; clamp independently at device limits"
                          onClick={() => setRelative(true)}
                        >
                          Relative trim
                        </button>
                        <button
                          className={!relative ? 'active' : ''}
                          aria-pressed={!relative}
                          title="Set every compatible member to the same value"
                          onClick={() => setRelative(false)}
                        >
                          Absolute set
                        </button>
                      </div>
                      <ConvergeControls
                        ids={targetIds}
                        workspace={w}
                        masks={resolved.masks}
                        disabled={readOnly}
                        busy={snapshot.converging || snapshot.busy > 0}
                      />
                    </div>
                  </>
                )}
                <GangControls
                  descriptors={activeDescriptors}
                  sections={consoleSections}
                  channels={selectedChannels}
                  masks={resolved.masks}
                  relative={relative}
                  disabled={controlsDisabled || snapshot.converging}
                  multiplier={multiplier}
                  favorites={w.favorites}
                  toggleFavorite={readOnly ? undefined : toggleFavorite}
                  onReset={(s) => reset(targetIds, s, undefined, resolved.masks)}
                />
                <div className="console-parameters console-summary">
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
              </>
            )}
          </section>
        )}
        <div
          className={`channel-grid ${view === 'favorites' ? 'pins-view' : ''}`}
          {...reorder.handlers}
        >
          {orderedCards.map((id, index) => {
            const g = shownGangCards.find((item) => item.id === id)
            if (g)
              return (
                <GangCard
                  key={`gang-${g.id}`}
                  gang={g}
                  grip={reorder.grip(id, g.name)}
                  dropTarget={reorder.target === id}
                  workspace={w}
                  disabled={readOnly || snapshot.converging}
                  multiplier={multiplier}
                  selected={(preview ?? selectedTokens).includes(g.id)}
                  busy={snapshot.converging || snapshot.busy > 0}
                  onSelect={(e) => selectChannel(g.id, e.ctrlKey || e.metaKey)}
                  onOpen={
                    currentViewGang?.id === g.id ? undefined : () => selectView(gangViewKey(g.id))
                  }
                  onHide={view === 'all' ? () => desk.showGangCard(g.id, false) : undefined}
                  onReset={(section) => reset(g.members, section, g.parameters)}
                />
              )
            const c = visibleChannels.find((channel) => channel.id === id)!
            return (
              <ChannelCard
                key={c.id}
                channel={c}
                grip={reorder.grip(id, c.label)}
                dropTarget={reorder.target === id}
                index={index}
                workspace={w}
                selected={previewIds.includes(c.id)}
                gangSelected={w.gangs.some(
                  (g) => selectedTokens.includes(g.id) && g.members.includes(c.id),
                )}
                selectionColor={group?.color}
                edit={editLayout}
                disabled={readOnly || snapshot.converging}
                target={c.id === w.convergeTargetId}
                targetBusy={snapshot.busy > 0}
                onTarget={() =>
                  desk.setConvergeTarget(c.id === w.convergeTargetId ? undefined : c.id)
                }
                onSelect={(e) => selectChannel(c.id, e.ctrlKey || e.metaKey)}
                multiplier={multiplier}
                onReset={(section) => reset([c.id], section)}
              />
            )
          })}
        </div>
        {!orderedCards.length && query && (
          <div className="empty-small">
            <Search size={24} />
            <p>No cards match “{query}”.</p>
          </div>
        )}
        {!orderedCards.length && !query && currentCustomView && (
          <p className="muted">Edit this view to add cards.</p>
        )}
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
      {dialog === 'devices' && (
        <DeviceDialog
          workspace={w}
          close={close}
          readOnly={readOnly}
          initialSelection={deviceSelection}
        />
      )}
      {dialog === 'recorders' && (
        <RecorderOverview
          configs={w.recorders ?? []}
          states={recorderStates}
          readOnly={readOnly}
          openDevice={openDevices}
          close={close}
        />
      )}
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
          masks={resetScope.masks}
          close={close}
        />
      )}
      {dialog === 'workspace' && <WorkspaceDialog workspace={w} close={close} />}
      {dialog === 'new-workspace' && (
        <Modal title="New workspace" close={close}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const name = String(data.get('name')).trim()
              if (name)
                void changeWorkspace(() =>
                  desk.addWorkspace(
                    undefined,
                    data.get('setup') === 'demo' ? 'demo' : 'empty',
                    name,
                  ),
                )
            }}
          >
            <label className="field">
              Workspace name
              <input name="name" maxLength={100} required />
            </label>
            <label className="field">
              Start with
              <select name="setup">
                <option value="empty">Empty workspace</option>
                <option value="demo">Demo devices</option>
              </select>
            </label>
            <div className="modal-footer">
              <button className="button primary">Create workspace</button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'view' && (
        <ViewDialog
          workspace={w}
          view={w.views?.find((item) => item.id === viewEditorId)}
          close={close}
          saved={(id) => {
            selectView(customViewKey(id))
            close()
          }}
        />
      )}
      {dialog === 'help' && (
        <Modal
          title="A desk for every source"
          subtitle="SignalShade · Individual precision. Collective control."
          close={close}
        >
          <div className="help-content">
            <h3>Start with the demo</h3>
            <p>
              Use the Quick tab for your chosen controls. Open Proc amp or RGB on a card for the
              full section. Restore default layout in Customize desk if controls are hidden. All
              demo devices are simulated and generate no network traffic.
            </p>
            <h3>Trim together</h3>
            <p>
              Ctrl/⌘-click channel headers to toggle a selection, or drag from a header or empty
              grid space to select multiple cards. Gang headers and Ctrl/⌘-clicking sidebar gangs
              can join the selection too; overlapping members adjust once. Ctrl/⌘-drag adds to the
              selection; Escape clears it. Save your selection as a gang when needed. Relative trim
              adds to each member’s existing values. Absolute set gives every member the same value,
              within device limits. Single-channel edits always stay local.
            </p>
            <p>
              Converge Small/Large closes 5%/20% of the gap toward each control’s median. Mark a
              golden camera with its target icon to converge toward its settings instead, leaving it
              unchanged. Clear target restores median convergence; Clear selection leaves the target
              in place. Both clearing controls are beside the page heading.
            </p>
            <h3>Connect your fleet</h3>
            <p>
              Add a device by IP or choose one from a network scan. Its mapped controls become
              available after connecting. Use device, channel, or desk locks when you want to pause
              adjustments.
            </p>
            <h3>Protect your setup</h3>
            <p>
              Export a workspace backup from the workspace menu. Imported workspaces never send
              commands automatically. Hardware credentials are kept in session memory only.
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
    </div>
  )
}

function ChannelCard({
  channel: c,
  index,
  grip,
  dropTarget,
  workspace: w,
  selected,
  gangSelected,
  selectionColor,
  edit,
  disabled,
  onSelect,
  onReset,
  multiplier,
  target,
  targetBusy,
  onTarget,
}: {
  channel: Channel
  index: number
  grip?: ReactNode
  dropTarget: boolean
  workspace: ReturnType<typeof desk.getSnapshot>['workspace']
  selected: boolean
  gangSelected: boolean
  selectionColor?: string
  edit: boolean
  disabled: boolean
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void
  multiplier: number
  onReset: (section?: Section) => void
  target: boolean
  targetBusy: boolean
  onTarget: () => void
}) {
  const device = w.devices.find((d) => d.id === c.deviceId)!
  const [label, setLabel] = useState(c.label),
    [renaming, setRenaming] = useState(false)
  const [controlTab, setControlTab] = useState<Section | 'quick'>('quick')
  const [rgbFamily, setRgbFamily] = useState<RgbFamily>('Gain')
  const families = availableRgbFamilies(c.descriptors)
  const activeRgbFamily = families.includes(rgbFamily) ? rgbFamily : (families[0] ?? 'Gain')
  const cardSections = visibleSections(w.hiddenSections).filter((section) =>
    c.descriptors.some((d) => d.section === section),
  )
  const activeTab =
    controlTab === 'quick' || !cardSections.includes(controlTab) ? 'quick' : controlTab
  const descriptors =
    activeTab === 'quick'
      ? quickControls(c, w.favorites)
      : activeTab === 'RGB correction'
        ? [
            ...c.descriptors.filter((d) => d.id === 'rgbEnabled'),
            ...rgbControls(c.descriptors, activeRgbFamily),
          ]
        : c.descriptors.filter((d) => d.section === activeTab)
  const blocked =
    disabled || c.locked || !device.armed || device.status !== 'online' || !!c.issue || !c.updatedAt
  const quickStageDescriptors =
    activeTab === 'quick'
      ? quickStages(
          [...cardSections, ...descriptors.map((descriptor) => descriptor.section)],
          c.descriptors,
        )
      : []
  const fields = descriptors.filter(
    (d) => !quickStageDescriptors.some((stage) => stage.id === d.id),
  )
  const groups = w.gangs.filter((g) => g.members.includes(c.id))
  return (
    <article
      className={`channel-card ${selected ? 'selected' : ''} ${gangSelected ? 'gang-member' : ''} ${c.locked ? 'locked' : ''} ${target ? 'converge-target' : ''} ${dropTarget ? 'card-drop-target' : ''}`}
      aria-label={`${c.label} channel`}
      data-channel-id={c.id}
      data-selection-id={c.id}
      style={{ '--selection-color': selectionColor ?? 'var(--accent)' } as CSSProperties}
    >
      <div className="card-heading">
        {grip}
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
              ? 'ERROR'
              : device.status !== 'online'
                ? 'OFFLINE'
                : c.pending
                  ? 'PENDING'
                  : !device.armed
                    ? 'READ ONLY'
                    : 'LIVE'}
        </span>
        <button
          className="icon-button tiny card-target"
          disabled={disabled || targetBusy}
          aria-pressed={target}
          aria-label={`Use ${c.label} as Converge target`}
          title={
            target
              ? 'Golden camera — Converge leaves this camera unchanged. Click to clear.'
              : 'Use this camera as the Converge target'
          }
          onClick={onTarget}
        >
          <Target size={15} />
        </button>
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
        </div>
      )}
      <div className="card-control-bar">
        <div className="card-control-tabs" role="tablist" aria-label={`Controls for ${c.label}`}>
          {(['quick', ...cardSections] as const).map((tab) => (
            <button
              key={tab}
              data-control-section={
                tab === 'RGB correction' ? 'rgb' : tab === 'Proc amp' ? 'procamp' : 'quick'
              }
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
        <QuickStageControls
          descriptors={quickStageDescriptors}
          channels={[c]}
          disabled={blocked}
          idPrefix="quick-card"
        />
      </div>
      {activeTab === 'RGB correction' && (
        <RgbTabs
          descriptors={c.descriptors}
          value={activeRgbFamily}
          onChange={setRgbFamily}
          label={`RGB controls for ${c.label}`}
        />
      )}
      <div
        className={`card-parameters ${activeTab === 'RGB correction' ? 'rgb-parameters' : ''}`}
        data-control-section={
          activeTab === 'RGB correction' ? 'rgb' : activeTab === 'Proc amp' ? 'procamp' : 'quick'
        }
        role="tabpanel"
        aria-label={`${activeTab === 'quick' ? 'Quick' : activeTab} controls for ${c.label}`}
      >
        {fields.map((d) => (
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
            <button
              key={g.id}
              title={g.name}
              onClick={onSelect}
              style={{ '--gang-color': g.color } as CSSProperties}
            >
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
