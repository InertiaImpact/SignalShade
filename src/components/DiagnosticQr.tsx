import { useState } from 'react'
import { diagnosticLink } from '../core/diagnostic-summary'
import { Modal } from './Modal'
import { QrImage } from './QrImage'

function DiagnosticText({ summary }: { summary: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <button
        className="button small"
        onClick={() => {
          void navigator.clipboard?.writeText(summary).then(
            () => setCopied(true),
            () => {},
          )
        }}
      >
        {copied ? 'Copied' : 'Copy summary'}
      </button>
      <textarea
        readOnly
        aria-label="Diagnostic summary"
        value={summary}
        rows={7}
        onFocus={(e) => e.currentTarget.select()}
      />
    </>
  )
}

export function DiagnosticQr({ summary, close }: { summary: string; close: () => void }) {
  return (
    <Modal
      title="Diagnostic QR"
      subtitle="Scan once, then copy the short summary."
      close={close}
      className="diagnostic-modal"
    >
      <QrImage
        link={diagnosticLink(summary, new URL(import.meta.env.BASE_URL, location.origin).href)}
        label="SignalShade diagnostic QR code"
        unavailable="QR unavailable. Copy the summary below."
      />
      <p>No device addresses, credentials or raw logs. Nothing is uploaded.</p>
      <DiagnosticText summary={summary} />
    </Modal>
  )
}

export function DiagnosticSummaryPage({ summary }: { summary: string }) {
  return (
    <main className="diagnostic-page">
      <h1>SignalShade diagnostic</h1>
      <p>Copy this summary and share it where you’re troubleshooting.</p>
      <DiagnosticText summary={summary} />
    </main>
  )
}
