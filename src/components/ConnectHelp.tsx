import { useEffect, useState } from 'react'
import {
  bridgeMessage,
  connectInstructions,
  connectRelease,
  detectConnect,
} from '../adapters/transport'

export function ConnectHelp() {
  const [version, setVersion] = useState<string>()
  const [origin, setOrigin] = useState('')
  const [note, setNote] = useState('')
  const [expanded, setExpanded] = useState(false)
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
    window.addEventListener('focus', detect)
    window.addEventListener('signalshade-connection-help', help)
    return () => {
      alive = false
      window.removeEventListener('focus', detect)
      window.removeEventListener('signalshade-connection-help', help)
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
          <p>
            Connections use the extension. Approve each device once, then click Connect again.
            Reload after an extension update.
          </p>
          {origin && (
            <button
              type="button"
              className="button"
              onClick={async () => {
                try {
                  await bridgeMessage('permission', { origin })
                  setNote(
                    'Approve the device in the Connect window, then click Connect again here.',
                  )
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
      {note && <p role="status">{note}</p>}
    </details>
  )
}
