// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DemoIndicator } from './DemoIndicator'
import { notifyDemoChange } from '../core/demo-feedback'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const render = (simulated: number, total: number) =>
  act(async () => {
    root.render(<DemoIndicator simulated={simulated} total={total} />)
  })
it('pulses a mixed fleet badge for demo changes, throttles repeats and clears after 700ms', async () => {
  await render(1, 2)
  expect(host.textContent).toBe('MIXED')
  expect(host.querySelector('.demo-ping')).toBeNull()
  await act(async () => notifyDemoChange(['FS1']))
  const pulse = host.querySelector('.demo-ping')
  expect(pulse).not.toBeNull()
  expect(host.querySelector('.mode-pill')?.getAttribute('title')).toContain('FS1')
  await act(async () => {
    vi.advanceTimersByTime(300)
    notifyDemoChange(['FS2'])
  })
  expect(host.querySelector('.demo-ping')).toBe(pulse)
  await act(async () => vi.advanceTimersByTime(400))
  expect(host.querySelector('.demo-ping')).toBeNull()
  await act(async () => notifyDemoChange(['FS1']))
  expect(host.querySelector('.demo-ping')).not.toBeNull()
  expect(host.textContent).toBe('MIXED')
})
it('handles the first demo addition and never pulses a live-only or empty fleet', async () => {
  await render(0, 1)
  expect(host.textContent).toBe('LIVE')
  await act(async () => {
    notifyDemoChange(['Added demo'])
    root.render(<DemoIndicator simulated={1} total={2} />)
  })
  expect(host.querySelector('.demo-ping')).not.toBeNull()
  await render(0, 1)
  expect(host.querySelector('.demo-ping')).toBeNull()
  await act(async () => notifyDemoChange(['Removed demo']))
  expect(host.textContent).toBe('LIVE')
  expect(host.querySelector('.demo-ping')).toBeNull()
  await render(0, 0)
  expect(host.textContent).toBe('NO DEVICES')
})
