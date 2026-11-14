import { validateWorkspace } from './persistence'
import type { Workspace } from './types'

export const workspaceQrFragment = '#workspace-v1='
export const workspacePartFragment = '#workspace-part-v1='
export const workspaceReadyFragment = '#workspace-ready-v1='
const maxQrBytes = 2953
const maxWorkspaceBytes = 5_000_000
const partLength = 1700
const maxParts = 32
const transferIdPattern = /^[a-f0-9]{64}$/

export class WorkspaceTooLargeForQr extends Error {}

export async function workspaceQrLinks(workspace: Workspace, base: string): Promise<string[]> {
  const portable = validateWorkspace(workspace)
  // Connection state is recreated on import. Omit diagnostic text and timestamps.
  for (const device of portable.devices) {
    device.status = device.simulated ? 'online' : 'offline'
    device.armed = device.simulated
    delete device.issue
  }
  for (const channel of portable.channels) {
    channel.pending = false
    channel.updatedAt = 0
    delete channel.issue
  }
  const json = new Blob([JSON.stringify(portable)])
  if (json.size > maxWorkspaceBytes) throw new WorkspaceTooLargeForQr()
  const compressed = json.stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer())
  if (bytes.length > (partLength * maxParts * 3) / 4) throw new WorkspaceTooLargeForQr()
  const url = new URL(base)
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  url.hash = workspaceQrFragment + token
  if (url.href.length <= maxQrBytes) return [url.href]
  const id = await tokenDigest(token)
  const total = Math.ceil(token.length / partLength)
  if (total > maxParts) throw new WorkspaceTooLargeForQr()
  return Array.from({ length: total }, (_, i) => {
    url.hash = `${workspacePartFragment}${id}.${i + 1}.${total}.${token.slice(i * partLength, (i + 1) * partLength)}`
    if (url.href.length > maxQrBytes) throw new WorkspaceTooLargeForQr()
    return url.href
  })
}

async function tokenDigest(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface WorkspaceQrPart {
  id: string
  index: number
  total: number
  token: string
}

export function readWorkspacePart(hash: string): WorkspaceQrPart {
  const [id, part, count, token, extra] = hash.slice(workspacePartFragment.length).split('.')
  const index = Number(part)
  const total = Number(count)
  if (
    !hash.startsWith(workspacePartFragment) ||
    !transferIdPattern.test(id) ||
    extra !== undefined ||
    !Number.isInteger(total) ||
    total < 2 ||
    total > maxParts ||
    !Number.isInteger(index) ||
    index < 1 ||
    index > total ||
    !token ||
    token.length > partLength ||
    (index < total && token.length !== partLength) ||
    !/^[\w-]+$/.test(token)
  )
    throw new Error('This workspace QR part is invalid or incomplete.')
  return { id, index, total, token }
}

export async function readWorkspaceQr(hash: string, multipartToken?: string): Promise<Workspace> {
  const multipart = hash.startsWith(workspaceReadyFragment)
  const token = multipart ? multipartToken : hash.slice(workspaceQrFragment.length)
  if (
    !token ||
    (!multipart && !hash.startsWith(workspaceQrFragment)) ||
    token.length > (multipart ? maxParts * partLength : maxQrBytes) ||
    !/^[\w-]+$/.test(token)
  )
    throw new Error('Invalid workspace QR link')
  if (multipart) {
    const id = hash.slice(workspaceReadyFragment.length)
    if (!transferIdPattern.test(id) || (await tokenDigest(token)) !== id)
      throw new Error('The scanned QR parts did not match.')
  }
  const encoded = atob(token.replace(/-/g, '+').replace(/_/g, '/'))
  const compressed = Uint8Array.from(encoded, (char) => char.charCodeAt(0))
  const reader = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let json = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxWorkspaceBytes) throw new Error('Workspace QR exceeds the import size limit')
      json += decoder.decode(chunk.value, { stream: true })
    }
    return validateWorkspace(JSON.parse(json + decoder.decode()))
  } finally {
    await reader.cancel().catch(() => {})
  }
}
