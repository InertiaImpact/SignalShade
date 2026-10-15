import { deviceOrigin } from './policy.js'
const params = new URLSearchParams(location.search)
const key = `approval:${params.get('tab')}`
const request = (await chrome.storage.session.get(key))[key]
const button = document.querySelector('#allow')
const result = document.querySelector('#result')
if (!request || request.token !== params.get('token') || Date.now() - request.created > 60000) {
  result.textContent = 'This request expired. Close this window and try again in SignalShade.'
} else {
  const origin = deviceOrigin(request.origin)
  document.querySelector('#address').textContent = origin
  button.disabled = false
  button.addEventListener('click', async () => {
    try {
      const u = new URL(origin)
      const allowed = await chrome.permissions.request({
        origins: [`${u.protocol}//${u.hostname}/*`],
      })
      if (!allowed) {
        result.textContent = 'Access was not granted. You can try again.'
        return
      }
      const origins = (await chrome.storage.local.get('origins')).origins ?? []
      await chrome.storage.local.set({ origins: [...new Set([...origins, origin])] })
      await chrome.storage.session.remove(key)
      button.disabled = true
      result.textContent =
        'Allowed. Return to SignalShade and click Connect again. You can close this window.'
    } catch (e) {
      result.textContent = e.message
    }
  })
}
