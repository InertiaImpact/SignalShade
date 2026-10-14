import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { publishUpdate } from './core/updates'
import { applyBroadcastTheme } from './theme'
import './styles.css'

applyBroadcastTheme(document.documentElement)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
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
