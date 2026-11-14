import { expect, it } from 'vitest'
import { demoWorkspace } from './demo'
import {
  readWorkspaceQr,
  workspaceQrFragment,
  workspaceReadyFragment,
  workspaceQrLinks,
  readWorkspacePart,
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
  const [qr] = await workspaceQrLinks(original, base)
  const link = new URL(qr)
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

it('splits larger workspaces and validates the reconstructed transfer', async () => {
  await expect(readWorkspaceQr(workspaceQrFragment + 'invalid!')).rejects.toThrow()
  const large = demoWorkspace()
  large.views = Array.from({ length: 100 }, () => ({
    id: crypto.randomUUID(),
    name: crypto.randomUUID(),
    cards: ['demo-ch-1'],
  }))
  const links = await workspaceQrLinks(large, base)
  expect(links.length).toBeGreaterThan(1)
  const parts = links.map((link) => readWorkspacePart(new URL(link).hash))
  expect(parts.map(({ index }) => index)).toEqual(parts.map((_, i) => i + 1))
  expect(parts.every(({ id, total }) => id === parts[0].id && total === parts.length)).toBe(true)
  const hash = workspaceReadyFragment + parts[0].id
  const joined = parts.map(({ token }) => token).join('')
  expect((await readWorkspaceQr(hash, joined)).views).toEqual(large.views)
  await expect(readWorkspaceQr(hash, joined.slice(1))).rejects.toThrow('did not match')
})
