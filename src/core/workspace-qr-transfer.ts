import { database } from './persistence'
import { readWorkspacePart, readWorkspaceQr, workspaceReadyFragment } from './workspace-qr'

interface Transfer {
  id: string
  total: number
  parts: Record<number, string>
  updated: number
}

// Scanner links may open separate tabs. An IndexedDB transaction keeps simultaneous scans atomic.
async function updateTransfers<T>(
  update: (transfers: Transfer[]) => { next: Transfer[]; value: T },
) {
  const db = await database()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite')
      const store = tx.objectStore('workspace')
      const request = store.get('qr-transfers')
      request.onsuccess = () => {
        try {
          const transfers = ((request.result ?? []) as Transfer[]).filter(
            (transfer) => Date.now() - transfer.updated < 86_400_000,
          )
          const { next, value } = update(transfers)
          store.put(next, 'qr-transfers')
          tx.oncomplete = () => resolve(value)
        } catch (error) {
          tx.abort()
          reject(error)
        }
      }
      tx.onabort = () => reject(tx.error ?? new Error('Could not save scanned QR parts.'))
    })
  } finally {
    db.close()
  }
}

export async function collectWorkspacePart(hash: string) {
  const part = readWorkspacePart(hash)
  return updateTransfers((transfers) => {
    const existing = transfers.find((transfer) => transfer.id === part.id)
    if (
      existing &&
      (existing.total !== part.total ||
        (existing.parts[part.index] && existing.parts[part.index] !== part.token))
    )
      throw new Error('This QR part conflicts with the saved scan.')
    const parts = { ...existing?.parts, [part.index]: part.token }
    const value = { id: part.id, total: part.total, parts, updated: Date.now() }
    return {
      next: [value, ...transfers.filter((transfer) => transfer.id !== part.id)].slice(0, 4),
      value,
    }
  })
}

export async function readCollectedWorkspace(hash: string) {
  const id = hash.slice(workspaceReadyFragment.length)
  const transfer = await updateTransfers((transfers) => ({
    next: transfers,
    value: transfers.find((item) => item.id === id),
  }))
  if (!transfer || Object.keys(transfer.parts).length !== transfer.total)
    throw new Error('Scan all parts in this browser before importing.')
  const token = Array.from({ length: transfer.total }, (_, i) => transfer.parts[i + 1]).join('')
  return readWorkspaceQr(hash, token)
}

export async function forgetWorkspaceParts(id: string) {
  await updateTransfers((transfers) => ({
    next: transfers.filter((transfer) => transfer.id !== id),
    value: undefined,
  }))
}
