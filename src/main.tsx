import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        const announce = () => {
          if (registration.waiting && navigator.serviceWorker.controller)
            window.dispatchEvent(
              new CustomEvent('signalshade-update', { detail: registration.waiting }),
            )
        }
        announce()
        registration.addEventListener('updatefound', () =>
          registration.installing?.addEventListener('statechange', announce),
        )
      })
      .catch(() => {})
  })
}
