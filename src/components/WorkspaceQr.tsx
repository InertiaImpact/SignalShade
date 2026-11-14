import { useEffect, useState } from 'react'
import { downloadJson } from '../core/persistence'
import type { Workspace } from '../core/types'
import {
  workspaceQrLinks,
  WorkspaceTooLargeForQr,
  readWorkspaceQr,
  workspaceQrFragment,
  workspaceReadyFragment,
  workspacePartFragment,
} from '../core/workspace-qr'
import { collectWorkspacePart, readCollectedWorkspace } from '../core/workspace-qr-transfer'
import { Modal } from './Modal'
import { QrImage } from './QrImage'

export function WorkspaceQr({ workspace, close }: { workspace: Workspace; close: () => void }) {
  const [captured] = useState(workspace)
  const [result, setResult] = useState<{ links: string[] } | { error: string }>()
  const [index, setIndex] = useState(0)
  useEffect(() => {
    let current = true
    void workspaceQrLinks(captured, new URL(import.meta.env.BASE_URL, location.origin).href).then(
      (links) => {
        if (current) setResult({ links })
      },
      (error) => {
        if (current)
          setResult({
            error:
              error instanceof WorkspaceTooLargeForQr
                ? 'This workspace is too large for QR transfer. Download the workspace JSON to transfer it.'
                : 'QR unavailable in this browser. Download the workspace JSON to transfer it.',
          })
      },
    )
    return () => {
      current = false
    }
  }, [captured])

  return (
    <Modal
      title="Export workspace as QR code"
      subtitle={captured.name}
      close={close}
      className="workspace-qr-modal"
    >
      {result && 'links' in result ? (
        <>
          {result.links.length > 1 && (
            <div className="workspace-qr-parts">
              <button className="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                Previous
              </button>
              <strong aria-live="polite">
                Code {index + 1} of {result.links.length}
              </strong>
              <button
                className="button"
                disabled={index + 1 === result.links.length}
                onClick={() => setIndex(index + 1)}
              >
                Next code
              </button>
            </div>
          )}
          <QrImage
            key={index}
            link={result.links[index]}
            label="SignalShade workspace QR code"
            unavailable="QR unavailable. Download the workspace JSON to transfer it."
          />
          <p>
            {result.links.length > 1 ? (
              'Open each scanned link in the same browser on the receiving device. You can scan the codes in any order.'
            ) : (
              <>
                Scan on the receiving device, then choose <strong>Import as workspace</strong>.
              </>
            )}
          </p>
          <p className="muted">
            The code includes device addresses, labels, and saved settings. Share it with people who
            should have that setup.
          </p>
        </>
      ) : (
        <p role="status">{result?.error ?? 'Preparing QR…'}</p>
      )}
      <div className="modal-footer">
        <button
          className="button"
          onClick={() => downloadJson('signalshade-workspace.json', captured)}
        >
          Download workspace JSON
        </button>
      </div>
    </Modal>
  )
}

export function WorkspaceQrPartPage({ hash }: { hash: string }) {
  const [progress, setProgress] = useState<Awaited<ReturnType<typeof collectWorkspacePart>>>()
  const [workspace, setWorkspace] = useState<Workspace>()
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    void collectWorkspacePart(hash)
      .then(async (part) => {
        if (!current) return
        setProgress(part)
        if (Object.keys(part.parts).length === part.total) {
          const data = await readCollectedWorkspace(workspaceReadyFragment + part.id)
          if (current) setWorkspace(data)
        }
      })
      .catch((error: unknown) => {
        if (current) setError(error instanceof Error ? error.message : 'Could not save this scan.')
      })
    return () => {
      current = false
    }
  }, [hash])
  const missing =
    progress &&
    Array.from({ length: progress.total }, (_, i) => i + 1).filter((part) => !progress.parts[part])
  return (
    <main className="diagnostic-page">
      <h1>Workspace QR transfer</h1>
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : progress ? (
        <>
          <p role="status">
            {progress.total - (missing?.length ?? 0)} of {progress.total} codes scanned.
          </p>
          {missing?.length ? (
            <p>Open the remaining codes in this browser: {missing.join(', ')}.</p>
          ) : workspace ? (
            <>
              <h2>{workspace.name}</h2>
              <div className="button-row">
                <a className="button primary" href={workspaceReadyFragment + progress.id}>
                  Continue to import
                </a>
                <button
                  className="button"
                  onClick={() => downloadJson('signalshade-workspace.json', workspace)}
                >
                  Download workspace JSON
                </button>
              </div>
            </>
          ) : (
            <p>Checking workspace…</p>
          )}
        </>
      ) : (
        <p role="status">Saving scan…</p>
      )}
    </main>
  )
}

export function isWorkspaceImportHash(hash: string) {
  return hash.startsWith(workspaceReadyFragment) || hash.startsWith(workspaceQrFragment)
}

export function isWorkspacePartHash(hash: string) {
  return hash.startsWith(workspacePartFragment)
}

export function ImportWorkspaceQr({
  hash,
  disabled,
  blockedReason,
  onImport,
  close,
}: {
  hash: string
  disabled: boolean
  blockedReason?: string
  onImport: (workspace: Workspace) => Promise<void>
  close: () => void
}) {
  const [workspace, setWorkspace] = useState<Workspace>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let current = true
    const read = hash.startsWith(workspaceReadyFragment)
      ? readCollectedWorkspace(hash)
      : readWorkspaceQr(hash)
    void read.then(
      (data) => {
        if (current) setWorkspace(data)
      },
      () => {
        if (current) setError('This workspace QR link is invalid or incomplete.')
      },
    )
    return () => {
      current = false
    }
  }, [hash])

  return (
    <Modal
      title="Import workspace from QR"
      close={() => {
        if (!saving) close()
      }}
    >
      {workspace ? (
        <>
          <h3>{workspace.name}</h3>
          <p>
            {workspace.devices.length + (workspace.recorders?.length ?? 0)} devices ·{' '}
            {workspace.channels.length} channels · {workspace.gangs.length} gangs ·{' '}
            {workspace.views?.length ?? 0} custom views
          </p>
          <p className="muted">Adds a separate workspace with its hardware disconnected.</p>
          {blockedReason && (
            <p role="status" className="text-warning">
              {blockedReason}
            </p>
          )}
        </>
      ) : (
        !error && <p role="status">Reading workspace…</p>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <button className="button" disabled={saving} onClick={close}>
          {workspace ? 'Cancel' : 'Close'}
        </button>
        {workspace && (
          <button
            className="button primary"
            disabled={disabled || saving}
            onClick={async () => {
              setSaving(true)
              setError('')
              try {
                await onImport(workspace)
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Could not import workspace.')
                setSaving(false)
              }
            }}
          >
            {saving ? 'Importing…' : 'Import as workspace'}
          </button>
        )}
      </div>
    </Modal>
  )
}
