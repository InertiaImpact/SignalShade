// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoWorkspace } from '../core/demo'
import type { Channel } from '../core/types'
import { ParameterControl } from './ParameterControl'

const adjust = vi.hoisted(() => vi.fn())
vi.mock('../core/store', () => ({ desk: { adjust } }))
let root: Root, host: HTMLDivElement
let channels: Channel[]
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  adjust.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  channels = demoWorkspace().channels.slice(0, 3)
  for (const [i, value] of [0.3, 0.9, 1.2].entries()) channels[i].values.gain = value
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
async function render(relative = true, compact = false) {
  await act(async () =>
    root.render(
      <ParameterControl
        descriptor={channels[0].descriptors.find((d) => d.id === 'gain')!}
        channels={channels}
        relative={relative}
        disabled={false}
        multiplier={5}
        compact={compact}
      />,
    ),
  )
}
const slider = () => host.querySelector<HTMLInputElement>('input[type=range]')!
const ticks = () => [...host.querySelectorAll<HTMLElement>('.member-tick')]
async function move(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider(), value)
    slider().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('shows each member on the native range, including coincident positions and compact gang cards', async () => {
  channels[2].values.gain = 0.9
  await render(true, true)
  expect(ticks()).toHaveLength(3)
  expect(ticks().map((t) => t.style.left)).toEqual(['20%', '60%', '60%'])
  expect(slider().min).toBe('0')
  expect(slider().max).toBe('1.5')
  expect(host.textContent).not.toContain('Members:')
  expect(adjust).not.toHaveBeenCalled()
})
it('uses the full combined range when compatible members have different limits', async () => {
  channels[1].descriptors.find((d) => d.id === 'gain')!.max = 3
  channels[0].values.gain = 0
  channels[1].values.gain = 3
  await render()
  expect(slider().max).toBe('3')
  expect(
    ticks()
      .slice(0, 2)
      .map((t) => t.style.left),
  ).toEqual(['0%', '100%'])
})
it('keeps one relative gesture anchored while confirmed member positions update during the drag', async () => {
  await render()
  expect(Number(slider().value)).toBeCloseTo(0.8)
  await move('1')
  expect(adjust.mock.calls[0].slice(0, 2)).toEqual([channels.map((c) => c.id), 'gain'])
  expect(adjust.mock.calls[0][2]).toBeCloseTo(0.2)
  expect(adjust.mock.calls[0][3]).toBe('relative')
  const gesture = adjust.mock.calls[0][4]
  channels = channels.map((c) => ({ ...c, values: { ...c.values, gain: c.values.gain! + 0.2 } }))
  await render()
  expect(parseFloat(ticks()[0].style.left)).toBeCloseTo(100 / 3)
  expect(slider().value).toBe('1')
  await move('1.1')
  expect(adjust.mock.calls[1][2]).toBeCloseTo(0.1)
  expect(adjust.mock.calls[1][4]).toBe(gesture)
  await act(async () => {
    slider().dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
  })
  expect(slider().getAttribute('aria-valuetext')).toBe('0.00 relative trim')
  expect(Number(slider().value)).toBeCloseTo(1)
})
it('shows readback positions at limits and external changes without inventing pending values', async () => {
  await render()
  channels[0].values.gain = 0
  channels[1].values.gain = 1.5
  channels[2].values.gain = 0.75
  await render()
  expect(ticks().map((t) => t.style.left)).toEqual(['0%', '100%', '50%'])
  expect(adjust).not.toHaveBeenCalled()
})
it('keeps arrow trims and absolute mode behavior intact', async () => {
  await render()
  const increase = host.querySelector<HTMLButtonElement>('button[aria-label="Increase Gain"]')!
  await act(async () => increase.click())
  expect(adjust.mock.calls[0][2]).toBeCloseTo(0.05)
  expect(adjust.mock.calls[0][3]).toBe('relative')
  await render(false)
  expect(ticks()).toHaveLength(0)
  await move('1.2')
  expect(adjust.mock.calls[1].slice(1, 4)).toEqual(['gain', 1.2, 'absolute'])
})
it('retains the centered trim for one member and hides ticks for incompatible controls', async () => {
  const all = channels
  channels = [channels[0]]
  await render()
  expect(ticks()).toHaveLength(0)
  expect(slider().value).toBe('0')
  expect(Number(slider().min)).toBeCloseTo(-0.5)
  channels = all
  channels[1].descriptors.find((d) => d.id === 'gain')!.unit = 'native'
  await render()
  expect(slider().disabled).toBe(true)
  expect(ticks()).toHaveLength(0)
})
async function renderToggle(kind: 'toggle' | 'enum' | 'number' = 'toggle', disabled = false) {
  const descriptor = { ...channels[0].descriptors.find((d) => d.id === 'procEnabled')!, kind }
  if (kind === 'enum')
    descriptor.choices = [
      { value: 0, label: 'Off' },
      { value: 1, label: 'On' },
    ]
  channels = channels.map((c) => ({
    ...c,
    descriptors: c.descriptors.map((d) => (d.id === descriptor.id ? descriptor : d)),
  }))
  await act(async () =>
    root.render(
      <ParameterControl
        descriptor={descriptor}
        channels={channels}
        relative
        disabled={disabled}
        multiplier={1}
        compact
      />,
    ),
  )
}
const stateButton = (state: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="Proc amp ${state}"]`)!
it('replaces boolean stage dropdowns with Off / Mixed / On and counts members with ticks', async () => {
  channels.forEach((c, i) => (c.values.procEnabled = i === 2 ? 1 : 0))
  await renderToggle()
  expect(host.querySelector('select')).toBeNull()
  expect(host.querySelector('.state-mixed.active')?.textContent).toBe('Mixed')
  expect(stateButton('Off').querySelectorAll('.state-ticks i')).toHaveLength(2)
  expect(stateButton('On').querySelectorAll('.state-ticks i')).toHaveLength(1)
  expect(stateButton('Off').getAttribute('aria-description')).toBe('2 of 3 members')
  await act(async () => (host.querySelector('.state-mixed') as HTMLElement).click())
  expect(adjust).not.toHaveBeenCalled()
  await act(async () => stateButton('On').click())
  expect(adjust.mock.calls[0].slice(0, 4)).toEqual([
    channels.map((c) => c.id),
    'procEnabled',
    1,
    'absolute',
  ])
  expect(host.querySelector('.state-mixed.active')).not.toBeNull() // Wait for actual readbacks.
  channels.forEach((c) => (c.values.procEnabled = 1))
  await renderToggle()
  expect(stateButton('On').getAttribute('aria-pressed')).toBe('true')
  expect(stateButton('Off').querySelectorAll('.state-ticks i')).toHaveLength(0)
  expect(stateButton('On').querySelectorAll('.state-ticks i')).toHaveLength(3)
  await act(async () => stateButton('On').click())
  expect(adjust).toHaveBeenCalledTimes(1) // Selecting the current state sends no redundant writes.
  await act(async () => stateButton('Off').click())
  expect(adjust.mock.calls[1].slice(1, 4)).toEqual(['procEnabled', 0, 'absolute'])
})
it.each(['enum', 'number'] as const)(
  'uses the same stage toggle for native %s boolean descriptors',
  async (kind) => {
    await renderToggle(kind)
    expect(host.querySelector('select')).toBeNull()
    expect(host.querySelector('input[type=range]')).toBeNull()
    await act(async () => stateButton('Off').click())
    expect(adjust.mock.calls[0].slice(1, 4)).toEqual(['procEnabled', 0, 'absolute'])
  },
)
it('shows two buttons for an individual stage and respects control locks', async () => {
  channels = [channels[0]]
  await renderToggle('toggle', true)
  expect(host.querySelectorAll('.state-toggle button')).toHaveLength(2)
  expect(host.querySelector('.state-mixed')).toBeNull()
  expect(host.querySelector('.state-ticks')).toBeNull()
  await act(async () => stateButton('Off').click())
  expect(adjust).not.toHaveBeenCalled()
  expect(stateButton('Off').disabled).toBe(true)
})
it('does not count unreadable members as Off or invent a Mixed state', async () => {
  channels[0].values.procEnabled = 1
  channels[1].values.procEnabled = undefined
  channels[2].values.procEnabled = undefined
  await renderToggle()
  expect(stateButton('Off').querySelectorAll('.state-ticks i')).toHaveLength(0)
  expect(stateButton('On').querySelectorAll('.state-ticks i')).toHaveLength(1)
  expect(host.querySelector('.state-mixed.active')?.textContent).toBe('—')
  expect(host.querySelector('[role=status]')?.getAttribute('aria-label')).toContain('2 unavailable')
})
it('retains native dropdowns for controls with more than two settings', async () => {
  await act(async () =>
    root.render(
      <ParameterControl
        descriptor={channels[0].descriptors.find((d) => d.id === 'legalizer.mode')!}
        channels={channels}
        relative={false}
        disabled={false}
        multiplier={1}
      />,
    ),
  )
  expect(host.querySelector('select')?.options).toHaveLength(4) // Three native settings and Mixed.
  expect(host.querySelector('.state-toggle')).toBeNull()
})
