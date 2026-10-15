import { useEffect, useState } from 'react'
import {
  ensureDeviceAccess,
  connectInstructions,
  connectRelease,
  detectConnect,
} from '../adapters/transport'

export function ConnectHelp() {
  const [version, setVersion] = useState<string>()
  const [origin, setOrigin] = useState('')
  const [note, setNote] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [approval, setApproval] = useState<{ origin: string; url: string }>()
  useEffect(() => {
    let alive = true
    const detect = () =>
      void detectConnect().then((v) => {
        if (alive) setVersion(v)
      })
    const help = (event: Event) => {
      setOrigin((event as CustomEvent<string>).detail)
      setExpanded(true)
    }
    detect()
    const open = (e: Event) => {
      setApproval((e as CustomEvent<{ origin: string; url: string }>).detail)
      setExpanded(true)
    }
    const close = () => setApproval(undefined)
    window.addEventListener('signalshade-approval-open', open)
    window.addEventListener('signalshade-approval-close', close)
    window.addEventListener('focus', detect)
    window.addEventListener('signalshade-connection-help', help)
    return () => {
      alive = false
      window.removeEventListener('focus', detect)
      window.removeEventListener('signalshade-connection-help', help)
      window.removeEventListener('signalshade-approval-open', open)
      window.removeEventListener('signalshade-approval-close', close)
      window.dispatchEvent(new CustomEvent('signalshade-approval-cancel'))
    }
  }, [])
  return (
    <details
      className="connect-help"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>
        SignalShade Connect {version ? `· v${version} installed` : '· Browser connection help'}
      </summary>
      {version ? (
        <>
          {version === '0.1.0' && (
            <p>
              Update Connect to use approval inside this window.{' '}
              <a href={connectRelease}>Download latest ZIP</a> ·{' '}
              <a href={connectInstructions} target="_blank" rel="noreferrer">
                Update instructions
              </a>
            </p>
          )}
          <p>
            Connections use the extension. Approve a new device here; connection testing resumes
            automatically. Reload after an extension update.
          </p>
          {origin && (
            <button
              type="button"
              className="button"
              onClick={async () => {
                try {
                  await ensureDeviceAccess(origin)
                  setNote('Device allowed. Click Connect to test it.')
                } catch (e) {
                  setNote(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Allow device · {origin}
            </button>
          )}
        </>
      ) : (
        <>
          <p>
            If your browser blocks a reachable AJA device, SignalShade Connect can make the
            connection. It does not require a separate server.
          </p>
          <p>
            <a className="button" href={connectRelease}>
              Download extension ZIP
            </a>{' '}
            <a href={connectInstructions} target="_blank" rel="noreferrer">
              Installation instructions
            </a>
          </p>
          <ol>
            <li>Unzip into a permanent folder.</li>
            <li>
              Open <code>chrome://extensions</code> and enable Developer mode.
            </li>
            <li>
              Choose <strong>Load unpacked</strong> and select the folder containing{' '}
              <code>manifest.json</code>.
            </li>
            <li>Reload SignalShade, reconnect, and approve access to your device.</li>
          </ol>
          <p>
            GitHub downloads cannot install automatically. Managed work browsers may require IT
            approval. For updates, replace the files in the same folder and click Reload on the
            extension.
          </p>
        </>
      )}
      {approval && (
        <div className="connect-approval">
          <iframe title={`Allow ${approval.origin}`} src={approval.url} />
          <button
            className="button"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('signalshade-approval-cancel'))}
          >
            Cancel approval
          </button>
        </div>
      )}
      {note && <p role="status">{note}</p>}
    </details>
  )
}
