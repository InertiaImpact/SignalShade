import { useEffect, useRef, useState } from 'react'
import {
  bridgeMessage,
  connectInstructions,
  connectRelease,
  detectConnect,
} from '../adapters/transport'

export function ConnectHelp() {
  const [version, setVersion] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [shortcutStatus, setShortcutStatus] = useState('')
  const [approval, setApproval] = useState<{ origin: string; url: string }>()
  const panel = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    let alive = true
    const detect = () =>
      void detectConnect().then((v) => {
        if (alive) setVersion(v)
      })
    const help = () => {
      setExpanded(true)
    }
    detect()
    const open = (e: Event) => {
      setApproval((e as CustomEvent<{ origin: string; url: string }>).detail)
      setExpanded(true)
      requestAnimationFrame(() =>
        panel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      )
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
  const canOpenExtensions =
    !!version && version.localeCompare('0.3.2', undefined, { numeric: true }) >= 0
  const extensionsPage = async () => {
    setShortcutStatus('')
    try {
      if (canOpenExtensions) {
        const reply = (await bridgeMessage('openExtensions')) as { opened?: boolean }
        if (!reply.opened) throw new Error('Chrome extensions did not open')
      } else {
        await navigator.clipboard.writeText('chrome://extensions')
        setShortcutStatus('Copied chrome://extensions — paste it into Chrome’s address bar.')
      }
    } catch {
      setShortcutStatus('Open chrome://extensions in Chrome’s address bar to reload Connect.')
    }
  }
  return (
    <section className="connect-help-panel" aria-label="SignalShade Connect">
      <div className="connect-links">
        <strong>SignalShade Connect{version ? ` · v${version}` : ''}</strong>
        <a href={connectRelease}>Download latest ZIP</a>
        <a href={connectInstructions} target="_blank" rel="noreferrer">
          Install / update
        </a>
        <button className="button small" type="button" onClick={() => void extensionsPage()}>
          {canOpenExtensions ? 'Open Chrome extensions' : 'Copy Chrome extensions address'}
        </button>
      </div>
      {shortcutStatus && (
        <p className="muted" role="status">
          {shortcutStatus}
        </p>
      )}
      {!canOpenExtensions && (
        <p className="muted">
          Reload Connect at <code>chrome://extensions</code>.
        </p>
      )}
      <details
        ref={panel}
        className="connect-help"
        open={expanded}
        onToggle={(e) => setExpanded(e.currentTarget.open)}
      >
        <summary>{version ? 'Connection help' : 'Installation instructions'}</summary>
        {version ? (
          <>
            <p>
              Connections use the extension. Approve a new device here; connection testing resumes
              automatically. Reload after an extension update.
            </p>
          </>
        ) : (
          <>
            <p>
              If your browser blocks a reachable AJA device, SignalShade Connect can make the
              connection. It does not require a separate server.
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
      </details>
    </section>
  )
}
