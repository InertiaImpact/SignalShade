import { useEffect, useState } from 'react'
import { diagnosticLink } from '../core/diagnostic-summary'
import { Modal } from './Modal'

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
  const [code, setCode] = useState<{ count: number; pixels: string }>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let current = true
    void import('qrcode-generator')
      .then(({ default: qrcode }) => {
        const qr = qrcode(0, 'M')
        qr.addData(diagnosticLink(summary, new URL(import.meta.env.BASE_URL, location.origin).href))
        qr.make()
        const count = qr.getModuleCount()
        let pixels = ''
        for (let row = 0; row < count; row++)
          for (let col = 0; col < count; col++)
            if (qr.isDark(row, col)) pixels += `M${col} ${row}h1v1h-1z`
        if (current) setCode({ count, pixels })
      })
      .catch(() => {
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [summary])
  return (
    <Modal
      title="Diagnostic QR"
      subtitle="Scan once, then copy the short summary."
      close={close}
      className="diagnostic-modal"
    >
      {code ? (
        <svg
          className="diagnostic-qr"
          role="img"
          aria-label="SignalShade diagnostic QR code"
          viewBox={`-4 -4 ${code.count + 8} ${code.count + 8}`}
          shapeRendering="crispEdges"
        >
          <rect x="-4" y="-4" width={code.count + 8} height={code.count + 8} fill="white" />
          <path d={code.pixels} fill="black" />
        </svg>
      ) : (
        <p role="status">{failed ? 'QR unavailable. Copy the summary below.' : 'Preparing QR…'}</p>
      )}
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
