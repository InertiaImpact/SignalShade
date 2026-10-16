// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { emptyWorkspace } from '../core/demo'
import type { ProbeResult } from '../core/types'
import { DeviceDialog } from './DeviceDialog'

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  probe: vi.fn(),
  connect: vi.fn(),
  access: vi.fn(),
  bridge: vi.fn(),
  demo: vi.fn(),
  saveRecorders: vi.fn(),
  recorderConnect: vi.fn(),
  states: {} as Record<string, import('../recorders/types').RecorderSnapshot>,
  debug: vi.fn(),
}))
vi.mock('../core/store', () => ({
  desk: {
    connect: mocks.connect,
    addDemoDevice: mocks.demo,
    saveRecorders: mocks.saveRecorders,
    getSnapshot: () => ({ activities: [] }),
    recorders: {
      subscribe: () => () => {},
      getSnapshot: () => mocks.states,
      connect: mocks.recorderConnect,
      disconnect: vi.fn(),
    },
  },
}))
vi.mock('../core/diagnostics', async (original) => ({
  ...(await original<object>()),
  downloadDebugPackage: mocks.debug,
}))
vi.mock('../adapters/discovery', () => ({ scanDevices: mocks.scan }))
vi.mock('../adapters/transport', () => ({
  detectConnect: async () => '0.3.3',
  ensureDeviceAccess: mocks.access,
  bridgeMessage: mocks.bridge,
}))
vi.mock('./ConnectHelp', () => ({ ConnectHelp: () => null }))
vi.mock('../adapters/aja', async (original) => ({
  ...(await original<object>()),
  AjaAdapter: class {
    probe = mocks.probe
    dispose() {}
  },
}))

let root: Root, host: HTMLDivElement, scanSignal: AbortSignal, probeSignal: AbortSignal
let finishScan: () => void, finishProbe: (report: ProbeResult) => void
const report = {
  address: 'http://10.0.0.10',
  model: 'FS2',
  channels: [{ id: 'channel' }],
  checks: [],
  descriptors: [],
  rawDescriptorCount: 1,
} as unknown as ProbeResult
const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!
const click = (name: string) =>
  act(async () => {
    button(name).click()
  })
async function startScan() {
  const section = host.querySelector('section[aria-label="Scan network"]')!
  const inputs = section.querySelectorAll('input')
  await act(async () => {
    for (const [i, value] of ['10.0.0.1', '10.0.0.30'].entries()) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        inputs[i],
        value,
      )
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await act(async () => {
    section
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(mocks.scan).toHaveBeenCalledOnce()
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  mocks.bridge.mockResolvedValue({ allowed: true })
  mocks.access.mockResolvedValue(undefined)
  mocks.recorderConnect.mockImplementation(async (config) => {
    mocks.states[config.id] = {
      state: 'idle',
      updatedAt: Date.now(),
      scope: 'Recording only',
      media: [],
      warnings: [],
      canControl: true,
      enabled: false,
    }
  })
  mocks.scan.mockImplementation((_ips, signal, onResult, onProgress) => {
    scanSignal = signal
    onResult({ address: report.address, model: 'FS2', status: 'found', detail: 'Reachable' })
    onProgress(1)
    return new Promise<void>((resolve) => {
      finishScan = resolve
      signal.addEventListener('abort', resolve, { once: true })
    })
  })
  mocks.probe.mockImplementation((signal) => {
    probeSignal = signal
    return new Promise<ProbeResult>((resolve) => {
      finishProbe = resolve
    })
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<DeviceDialog workspace={emptyWorkspace()} readOnly={false} close={() => {}} />)
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it('adds a discovered device while scanning and preserves scan progress after Add completes', async () => {
  await startScan()
  expect(button('Add').disabled).toBe(false)
  await click('Add')
  expect(mocks.probe).toHaveBeenCalledOnce()
  await act(async () => finishProbe(report))
  expect(mocks.connect).toHaveBeenCalledOnce()
  expect(scanSignal.aborted).toBe(false)
  expect(button('Stop scan')).toBeDefined()
  expect(host.textContent).toContain('1 / 30 checked')
  expect(mocks.access).toHaveBeenCalledTimes(1) // Only the scan range; Add reuses it.
  await act(async () => finishScan())
})
it('stops a scan without cancelling an in-progress device connection', async () => {
  await startScan()
  await click('Add')
  await click('Stop scan')
  expect(scanSignal.aborted).toBe(true)
  expect(probeSignal.aborted).toBe(false)
  await act(async () => finishProbe(report))
  expect(mocks.connect).toHaveBeenCalledOnce()
})
it('cancels a device connection without stopping the scan', async () => {
  await startScan()
  await click('Add')
  await click('Cancel connection')
  expect(probeSignal.aborted).toBe(true)
  expect(scanSignal.aborted).toBe(false)
  await act(async () => finishProbe(report))
  expect(mocks.connect).not.toHaveBeenCalled()
  expect(button('Stop scan')).toBeDefined()
  await act(async () => finishScan())
})
it('routes a discovered HELO Plus to the recorder adapter in the same manager', async () => {
  mocks.scan.mockImplementationOnce((_ips, signal, onResult, onProgress) => {
    scanSignal = signal
    onResult({
      address: report.address,
      model: 'HELO Plus',
      name: 'Program recorder',
      title: 'AJA HELO Plus',
      status: 'found',
      detail: 'Reachable',
    })
    onProgress(1)
    return new Promise<void>((resolve) => {
      finishScan = resolve
    })
  })
  await startScan()
  await click('Add')
  expect(mocks.saveRecorders).toHaveBeenCalledWith([
    expect.objectContaining({
      address: report.address,
      model: 'HELO Plus',
      label: 'Program recorder',
    }),
  ])
  expect(mocks.recorderConnect).toHaveBeenCalledOnce()
  expect(mocks.probe).not.toHaveBeenCalled()
  await act(async () => finishScan())
})
it('shows a scanned system name beside its model and IP and uses it when adding a processor', async () => {
  mocks.scan.mockImplementationOnce((_ips, signal, onResult) => {
    scanSignal = signal
    onResult({
      address: report.address,
      model: 'FS2',
      name: 'Truck A shading',
      status: 'found',
      detail: 'Reachable',
    })
    return new Promise<void>((resolve) => {
      finishScan = resolve
    })
  })
  await startScan()
  const result = host.querySelector('.scan-result')!
  expect(result.querySelector('strong')?.textContent).toBe('Truck A shading')
  expect(result.textContent).toContain(`FS2 · ${report.address}`)
  await click('Add')
  await act(async () => finishProbe(report))
  expect(mocks.connect).toHaveBeenCalledWith(expect.anything(), report, 'Truck A shading')
  await act(async () => finishScan())
})
it('adds a selectable demo model and offers one combined debug download', async () => {
  await click('Demo device')
  const select = host.querySelector('section[aria-label="Add by IP"] select') as HTMLSelectElement
  await act(async () => {
    select.value = 'FS1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const form = host.querySelector('section[aria-label="Add by IP"] form')!
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(mocks.demo).toHaveBeenCalledWith('FS1', '')
  await click('Download debug ZIP')
  expect(mocks.debug).toHaveBeenCalledOnce()
  expect(mocks.access).not.toHaveBeenCalled()
})
it('retains an added device custom label when a scan reports a different system name', async () => {
  const workspace = emptyWorkspace()
  workspace.devices = [
    {
      id: report.address,
      address: report.address,
      label: 'Custom desk label',
      model: 'FS2',
      firmware: 'fixture',
      simulated: false,
      status: 'online',
      armed: true,
    },
  ]
  await act(async () =>
    root.render(<DeviceDialog workspace={workspace} readOnly={false} close={() => {}} />),
  )
  mocks.scan.mockImplementationOnce((_ips, _signal, onResult) => {
    onResult({
      address: report.address,
      model: 'FS2',
      name: 'Factory rack name',
      status: 'found',
      detail: 'Reachable',
    })
    return Promise.resolve()
  })
  await startScan()
  expect(host.querySelector('.connections-list')?.textContent).toContain('Custom desk label')
  expect(host.querySelector('.scan-result strong')?.textContent).toBe('Factory rack name')
  expect(button('Added').disabled).toBe(true)
  expect(mocks.connect).not.toHaveBeenCalled()
})
