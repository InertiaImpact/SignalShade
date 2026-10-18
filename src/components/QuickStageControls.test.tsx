// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoWorkspace } from '../core/demo'
import type { Workspace } from '../core/types'
import { notifyStageAdjustment } from '../core/stages'
import { GangCard } from './GangCard'

const adjust = vi.hoisted(() => vi.fn())
vi.mock('../core/store', () => ({ desk: { adjust } }))
let root: Root, host: HTMLDivElement, workspace: Workspace
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  adjust.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  workspace = demoWorkspace()
  workspace.gangs[0].members = workspace.channels.slice(0, 2).map((c) => c.id)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
async function render() {
  await act(async () =>
    root.render(
      <GangCard
        gang={workspace.gangs[0]}
        workspace={workspace}
        disabled={false}
        multiplier={1}
        onOpen={() => {}}
        onHide={() => {}}
        onReset={() => {}}
      />,
    ),
  )
}
const button = (name: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
it('shows mixed stage ticks in Quick, pulses the entire compact toggle and sends explicit enable actions', async () => {
  workspace.channels[0].values.procEnabled = 0
  await render()
  const group = host.querySelector('.quick-stage-controls .state-toggle')!
  expect(host.querySelectorAll('.state-toggle')).toHaveLength(1)
  expect(button('Proc amp Off').querySelectorAll('.state-ticks i')).toHaveLength(1)
  expect(button('Proc amp On').querySelectorAll('.state-ticks i')).toHaveLength(1)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Gain slider"]')?.disabled).toBe(
    false,
  )
  await act(async () => notifyStageAdjustment(workspace.channels.slice(0, 2), 'procEnabled'))
  expect(group.querySelector(':scope > .state-ping')).not.toBeNull()
  expect(group.querySelector('.state-mixed .state-ping')).toBeNull()
  await act(async () => button('Proc amp On').click())
  expect(adjust.mock.calls[0].slice(0, 4)).toEqual([
    ['demo-ch-1', 'demo-ch-2'],
    'procEnabled',
    1,
    'absolute',
  ])
})
it('points bypassed Quick sliders to the compact Off control and keeps unrelated RGB controls active', async () => {
  workspace.favorites = ['gain', 'redGain', 'procEnabled']
  workspace.channels.slice(0, 2).forEach((c) => (c.values.procEnabled = 0))
  await render()
  expect(host.querySelectorAll('.state-toggle')).toHaveLength(2) // Pinned enable is not duplicated.
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Gain slider"]')?.disabled).toBe(
    true,
  )
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="Red gain slider"]')?.disabled,
  ).toBe(false)
  const track = host.querySelector('.bypassed .slider-track')!
  await act(async () => track.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
  expect(button('Proc amp Off').querySelector('.state-ping')).not.toBeNull()
  expect(adjust).not.toHaveBeenCalled()
})
it('shows a masked stage’s status without allowing changes outside the gang mask', async () => {
  workspace.gangs[0].parameters = ['gain']
  workspace.channels[0].values.procEnabled = 0
  await render()
  expect(button('Proc amp On').disabled).toBe(true)
  expect(button('Proc amp Off').disabled).toBe(true)
  expect(host.querySelector('.state-mixed')?.textContent).toBe('Mixed')
  await act(async () => notifyStageAdjustment(workspace.channels.slice(0, 2), 'procEnabled'))
  expect(host.querySelector('.state-toggle > .state-ping')).not.toBeNull()
  await act(async () => button('Proc amp On').click())
  expect(adjust).not.toHaveBeenCalled()
})
