// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoWorkspace } from '../core/demo'
import type { Workspace } from '../core/types'
import { ConvergeControls } from './ConvergeControls'

const converge = vi.hoisted(() => vi.fn())
vi.mock('../core/store', () => ({ desk: { converge } }))
let root: Root, host: HTMLDivElement, workspace: Workspace
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  converge.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  workspace = demoWorkspace()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
async function render(ids = ['demo-ch-1', 'demo-ch-2'], busy = false, compact = false) {
  await act(async () =>
    root.render(
      <ConvergeControls
        ids={ids}
        workspace={workspace}
        masks={{ 'demo-ch-1': ['gain'] }}
        disabled={false}
        busy={busy}
        compact={compact}
      />,
    ),
  )
}
const button = (step: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="Converge ${step} step"]`)!
it('dispatches independent 5% and 20% steps with the selected masks', async () => {
  await render()
  expect(button('small').title).toContain('5%')
  expect(button('large').title).toContain('20%')
  await act(async () => button('small').click())
  await act(async () => button('large').click())
  expect(converge.mock.calls.map((c) => c[1])).toEqual(['small', 'large'])
  expect(converge.mock.calls[0][2]).toEqual({ 'demo-ch-1': ['gain'] })
})
it('allows a locked golden reference but blocks unavailable recipients, single selections and pending steps', async () => {
  workspace.convergeTargetId = 'demo-ch-1'
  workspace.channels[0].locked = true
  await render()
  expect(button('small').disabled).toBe(false)
  expect(button('small').title).toContain('target unchanged')
  await render(['demo-ch-1'])
  expect(button('small').disabled).toBe(true)
  await render(['demo-ch-1', 'demo-ch-2'], true)
  expect(button('small').disabled).toBe(true)
  workspace.channels[1].locked = true
  await render()
  expect(button('small').disabled).toBe(true)
})
it('retains clear accessible labels in compact gang header controls', async () => {
  await render(undefined, false, true)
  expect(button('small').textContent).toBe('S')
  expect(button('large').textContent).toBe('L')
  expect(host.querySelector('.compact-converge')).not.toBeNull()
})
