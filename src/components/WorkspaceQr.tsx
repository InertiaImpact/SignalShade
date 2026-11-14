import { useEffect, useState } from 'react'
import { downloadJson } from '../core/persistence'
import type { Workspace } from '../core/types'
import { workspaceQrLink, WorkspaceTooLargeForQr, readWorkspaceQr } from '../core/workspace-qr'
import { Modal } from './Modal'
import { QrImage } from './QrImage'

export function WorkspaceQr({ workspace, close }: { workspace: Workspace; close: () => void }) {
  const [captured] = useState(workspace)
  const [result, setResult] = useState<{ link: string } | { error: string }>()
  useEffect(() => {
    let current = true
    void workspaceQrLink(captured, new URL(import.meta.env.BASE_URL, location.origin).href).then(
      (link) => {
        if (current) setResult({ link })
      },
      (error) => {
        if (current)
          setResult({
            error:
              error instanceof WorkspaceTooLargeForQr
                ? 'This workspace is too large for one QR code. Download the workspace JSON to transfer it.'
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
      {result && 'link' in result ? (
        <>
          <QrImage
            link={result.link}
            label="SignalShade workspace QR code"
            unavailable="QR unavailable. Download the workspace JSON to transfer it."
          />
          <p>
            Scan on the receiving device, then choose <strong>Import as workspace</strong>.
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
    void readWorkspaceQr(hash).then(
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
