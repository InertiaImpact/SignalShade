import { z } from 'zod'
import type { Workspace } from './types'
import { visibleSections } from './layout'

const finite = z.number().finite()
const paramId = z
  .string()
  .regex(
    /^(gain|black|hue|saturation|procEnabled|rgbEnabled|(red|green|blue)(Gain|Black|Gamma)|legalizer\.[a-zA-Z0-9_.-]+)$/,
  )
const values = z.record(paramId, finite)
const descriptor = z
  .object({
    id: paramId,
    label: z.string().max(200),
    section: z.enum(['Proc amp', 'RGB correction', 'Legalizer']),
    min: finite,
    max: finite,
    step: finite.positive(),
    neutral: finite,
    unit: z.string().max(40),
    precision: z.number().int().min(0).max(8),
    kind: z.enum(['number', 'toggle', 'enum']),
    nativeId: z.string().max(200).optional(),
    scale: finite.optional(),
    offset: finite.optional(),
    choices: z
      .array(z.object({ value: finite, label: z.string().max(200) }))
      .max(100)
      .optional(),
  })
  .refine(
    (d) => d.max >= d.min && d.neutral >= d.min && d.neutral <= d.max && d.scale !== 0,
    'Invalid parameter range',
  )
const schema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(100),
  devices: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().max(100),
        model: z.enum(['FS4', 'FS2', 'FS1-X', 'FS1', 'FS-HDR']),
        firmware: z.string(),
        address: z.string().max(250),
        simulated: z.boolean(),
        status: z.enum(['online', 'offline', 'connecting']),
        armed: z.boolean(),
        issue: z.string().optional(),
      }),
    )
    .max(32),
  channels: z
    .array(
      z.object({
        id: z.string(),
        deviceId: z.string(),
        processor: z.number().int().min(1).max(4),
        label: z.string().min(1).max(100),
        source: z.string(),
        format: z.string(),
        context: z.string(),
        values,
        descriptors: z.array(descriptor).max(100),
        updatedAt: finite,
        locked: z.boolean(),
        pending: z.boolean(),
        issue: z.string().optional(),
      }),
    )
    .max(32),
  gangs: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        members: z.array(z.string()).max(32),
        parameters: z.array(paramId).max(100),
      }),
    )
    .max(100),
  presets: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100),
        createdAt: finite,
        channels: z
          .array(
            z.object({
              channelId: z.string(),
              label: z.string(),
              model: z.enum(['FS4', 'FS2', 'FS1-X', 'FS1', 'FS-HDR']),
              values,
              descriptors: z.array(descriptor).max(100),
            }),
          )
          .max(32),
      }),
    )
    .max(200),
  favorites: z.array(paramId).min(1).max(8),
  density: z.enum(['comfortable', 'compact']),
  hiddenSections: z.array(z.enum(['Proc amp', 'RGB correction', 'Legalizer'])).max(3),
})
export function validateWorkspace(input: unknown): Workspace {
  const parsed = schema.parse(input) as Workspace
  const shown = visibleSections(parsed.hiddenSections)
  parsed.hiddenSections = [...new Set(parsed.hiddenSections)].filter(
    (section) => !shown.includes(section),
  )
  const deviceIds = new Set(parsed.devices.map((d) => d.id))
  const channelIds = new Set(parsed.channels.map((c) => c.id))
  if (
    deviceIds.size !== parsed.devices.length ||
    channelIds.size !== parsed.channels.length ||
    new Set(parsed.gangs.map((g) => g.id)).size !== parsed.gangs.length ||
    new Set(parsed.presets.map((p) => p.id)).size !== parsed.presets.length
  )
    throw new Error('Duplicate IDs in workspace')
  if (
    parsed.channels.some((c) => !deviceIds.has(c.deviceId)) ||
    parsed.gangs.some((g) => g.members.some((id) => !channelIds.has(id)))
  )
    throw new Error('Workspace contains missing device or channel references')
  for (const c of parsed.channels) {
    if (new Set(c.descriptors.map((d) => d.id)).size !== c.descriptors.length)
      throw new Error('Duplicate channel parameters')
    for (const d of c.descriptors) {
      const value = c.values[d.id]
      if (value !== undefined && (value < d.min || value > d.max))
        throw new Error(`Value outside range: ${c.label} / ${d.label}`)
    }
  }
  return parsed
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('signalshade', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('workspace')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function loadWorkspace(): Promise<Workspace | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('workspace').objectStore('workspace').get('current')
      request.onsuccess = () => {
        try {
          resolve(request.result ? validateWorkspace(request.result) : undefined)
        } catch (e) {
          reject(e)
        }
      }
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
export async function saveWorkspace(workspace: Workspace) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite')
      tx.objectStore('workspace').put(workspace, 'current')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
