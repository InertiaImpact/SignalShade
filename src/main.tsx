import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { publishUpdate } from './core/updates'
import { applyBroadcastTheme } from './theme'
import './styles.css'
import { diagnosticFragment } from './core/diagnostic-summary'
import { DiagnosticSummaryPage } from './components/DiagnosticQr'

applyBroadcastTheme(document.documentElement)

const diagnostic = location.hash.startsWith(diagnosticFragment)
let summary = 'Invalid diagnostic link.'
if (diagnostic) {
  try {
    summary = decodeURIComponent(location.hash.slice(diagnosticFragment.length, 2200)).slice(0, 450)
  } catch {
    /* Keep malformed input out of the dashboard. */
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>{diagnostic ? <DiagnosticSummaryPage summary={summary} /> : <App />}</StrictMode>,
)

if (!diagnostic && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((registration) => {
        const announce = () => {
          if (registration.waiting && navigator.serviceWorker.controller)
            publishUpdate(registration.waiting)
        }
        announce()
        registration.addEventListener('updatefound', () =>
          registration.installing?.addEventListener('statechange', announce),
        )
        navigator.serviceWorker.addEventListener('controllerchange', () => publishUpdate(undefined))
        const check = () => {
          void registration
            .update()
            .then(announce)
            .catch(() => {})
        }
        check()
        setInterval(check, 5 * 60 * 1000)
      })
      .catch(() => {})
  })
}
