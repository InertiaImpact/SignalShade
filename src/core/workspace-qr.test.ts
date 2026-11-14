import { expect, it } from 'vitest'
import { demoWorkspace } from './demo'
import {
  readWorkspaceQr,
  workspaceQrFragment,
  workspaceQrLink,
  WorkspaceTooLargeForQr,
} from './workspace-qr'

const base = 'https://inertiaimpact.github.io/SignalShade/'

it('round trips the demo and preserves settings while clearing live connection state', async () => {
  const original = demoWorkspace()
  original.name = 'Régie 🎥'
  original.devices[0] = {
    ...original.devices[0],
    simulated: false,
    address: 'http://10.1.1.8',
    issue: 'diagnostic text',
  }
  original.channels[0].pending = true
  original.views = [{ id: 'example', name: 'Cameras', cards: ['demo-ch-1'] }]
  const link = new URL(await workspaceQrLink(original, base))
  const restored = await readWorkspaceQr(link.hash)

  expect(link.origin + link.pathname).toBe(base)
  expect(link.search).toBe('')
  expect(restored.name).toBe(original.name)
  expect(restored.views).toEqual(original.views)
  expect(restored.devices[0]).toMatchObject({
    address: 'http://10.1.1.8',
    status: 'offline',
    armed: false,
  })
  expect(restored.devices[0].issue).toBeUndefined()
  expect(restored.channels[0]).toMatchObject({
    pending: false,
    updatedAt: 0,
    values: original.channels[0].values,
  })
  expect(original.channels[0].pending).toBe(true)
})

it('rejects malformed links and reports workspaces too large for one code', async () => {
  await expect(readWorkspaceQr(workspaceQrFragment + 'invalid!')).rejects.toThrow()
  const large = demoWorkspace()
  large.views = Array.from({ length: 100 }, () => ({
    id: crypto.randomUUID(),
    name: crypto.randomUUID(),
    cards: ['demo-ch-1'],
  }))
  await expect(workspaceQrLink(large, base)).rejects.toBeInstanceOf(WorkspaceTooLargeForQr)
})
