import { validateWorkspace } from './persistence'
import type { Workspace } from './types'

export const workspaceQrFragment = '#workspace-v1='
const maxQrBytes = 2953
const maxWorkspaceBytes = 5_000_000

export class WorkspaceTooLargeForQr extends Error {}

export async function workspaceQrLink(workspace: Workspace, base: string) {
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
  if (bytes.length > maxQrBytes) throw new WorkspaceTooLargeForQr()
  const url = new URL(base)
  url.hash =
    workspaceQrFragment +
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  if (url.href.length > maxQrBytes) throw new WorkspaceTooLargeForQr()
  return url.href
}

export async function readWorkspaceQr(hash: string): Promise<Workspace> {
  const token = hash.slice(workspaceQrFragment.length)
  if (!hash.startsWith(workspaceQrFragment) || token.length > maxQrBytes || !/^[\w-]+$/.test(token))
    throw new Error('Invalid workspace QR link')
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
