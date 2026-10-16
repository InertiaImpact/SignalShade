import { defaultFavorites, parameters } from './color'
import type { Device, Workspace, Model, Channel } from './types'
import { broadcastTheme } from '../theme'

export function demoWorkspace(): Workspace {
  const devices: Device[] = [
    {
      id: 'demo-a',
      label: 'FS1',
      model: 'FS4',
      firmware: 'Demo',
      address: 'Demo device A',
      simulated: true,
      status: 'online',
      armed: true,
    },
    {
      id: 'demo-b',
      label: 'FS2',
      model: 'FS4',
      firmware: 'Demo',
      address: 'Demo device B',
      simulated: true,
      status: 'online',
      armed: true,
    },
    {
      id: 'demo-c',
      label: 'FS3',
      model: 'FS2',
      firmware: 'Demo',
      address: 'Demo device C',
      simulated: true,
      status: 'online',
      armed: true,
    },
  ]
  const labels = Array.from(
    { length: 10 },
    (_, i) => `${devices[Math.floor(i / 4)].label} - Input ${(i % 4) + 1}`,
  )
  return {
    version: 1,
    name: 'Studio A · Show workspace',
    devices,
    channels: labels.map((label, i) => ({
      id: `demo-ch-${i + 1}`,
      deviceId: devices[Math.floor(i / 4)].id,
      processor: (i % 4) + 1,
      label,
      source: `SDI ${(i % 4) + 1}`,
      format: '1080i / 59.94',
      context: 'demo-sdi-1080i',
      updatedAt: Date.now(),
      locked: false,
      pending: false,
      descriptors: structuredClone(parameters).map((d) =>
        i >= 8 && d.id.endsWith('Gamma') ? { ...d, step: 0.05 } : d,
      ),
      values: {
        ...Object.fromEntries(parameters.map((d) => [d.id, d.neutral])),
        procEnabled: 1,
        rgbEnabled: 1,
        gain: [1.02, 0.98, 1, 1.04, 1, 0.96, 1, 1, 1.08, 1][i],
        saturation: [1.05, 1.02, 1, 1.03, 0.98, 1, 1, 1, 1.04, 1][i],
        black: [0, -0.5, 0.5, 0, 0, -1, 0, 0, 0.5, 0][i],
      },
    })),
    gangs: [
      {
        id: 'gang-all',
        name: 'All',
        color: broadcastTheme.accent,
        members: Array.from({ length: 10 }, (_, i) => `demo-ch-${i + 1}`),
        parameters: [],
      },
      {
        id: 'gang-shaded',
        name: 'Shaded Cams',
        color: broadcastTheme['gang-shaded'],
        members: ['demo-ch-1', 'demo-ch-2', 'demo-ch-3', 'demo-ch-4'],
        parameters: [],
      },
      {
        id: 'gang-handheld',
        name: 'Handheld Cams',
        color: broadcastTheme['gang-handheld'],
        members: ['demo-ch-5', 'demo-ch-6'],
        parameters: [],
      },
    ],
    presets: [],
    favorites: defaultFavorites,
    density: 'comfortable',
    hiddenSections: [],
  }
}
export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    name: 'Untitled show',
    devices: [],
    channels: [],
    gangs: [],
    presets: [],
    favorites: defaultFavorites,
    density: 'comfortable',
    hiddenSections: [],
  }
}
export function demoDevice(
  model: Model,
  label: string,
  workspace: Workspace,
): { device: Device; channels: Channel[] } {
  let number = 1
  while (workspace.devices.some((d) => d.label === `FS${number}`)) number++
  const id = `demo-${crypto.randomUUID()}`,
    name = label.trim() || `FS${number}`
  const count = model === 'FS4' || model === 'FS-HDR' ? 4 : model === 'FS2' ? 2 : 1
  const descriptors = structuredClone(parameters).filter(
    (d) => model !== 'FS1' || d.section === 'Proc amp',
  )
  return {
    device: {
      id,
      label: name,
      model,
      firmware: 'Demo',
      address: '',
      simulated: true,
      status: 'online',
      armed: true,
    },
    channels: Array.from({ length: count }, (_, i) => ({
      id: `${id}/vid${i + 1}`,
      deviceId: id,
      processor: i + 1,
      label: `${name} - Input ${i + 1}`,
      source: `SDI ${i + 1}`,
      format: '1080i / 59.94',
      context: 'demo',
      updatedAt: Date.now(),
      locked: false,
      pending: false,
      descriptors: structuredClone(descriptors),
      values: Object.fromEntries(descriptors.map((d) => [d.id, d.neutral])),
    })),
  }
}
