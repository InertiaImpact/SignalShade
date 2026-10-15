import { deviceOrigin } from './policy.js'
const params = new URLSearchParams(location.search)
const key = `approval:${params.get('tab')}`
const request = (await chrome.storage.session.get(key))[key]
const button = document.querySelector('#allow')
const result = document.querySelector('#result')
const report = (approved) =>
  window.parent.postMessage(
    { source: 'signalshade-connect-approval', token: params.get('token'), approved },
    'https://inertiaimpact.github.io',
  )
if (!request || request.token !== params.get('token') || Date.now() - request.created > 120000) {
  result.textContent = 'This request expired. Close this window and try again in SignalShade.'
} else {
  const origins = request.scan ? request.origins.map(deviceOrigin) : [deviceOrigin(request.origin)]
  document.querySelector('#address').textContent = request.scan
    ? `${origins[0]} – ${new URL(origins.at(-1)).hostname}`
    : origins[0]
  if (request.scan) {
    document.querySelector('#purpose').textContent = 'Allow a read-only scan of this address range?'
    document.querySelector('#explanation').textContent =
      'Chrome will list the device addresses. Scan approval cannot change settings. Choose Add in SignalShade for a device you want to control.'
    button.textContent = 'Allow scan'
  }
  button.disabled = false
  button.addEventListener('click', async () => {
    try {
      const allowed = await chrome.permissions.request({
        origins: origins.map((origin) => {
          const u = new URL(origin)
          return `${u.protocol}//${u.hostname}/*`
        }),
      })
      if (!allowed) {
        result.textContent = 'Access was not granted.'
        report(false)
        return
      }
      if (request.scan)
        await chrome.storage.session.set({
          [`scan:${params.get('tab')}`]: { origins, expires: Date.now() + 30 * 60 * 1000 },
        })
      else {
        const previous = (await chrome.storage.local.get('origins')).origins ?? []
        await chrome.storage.local.set({ origins: [...new Set([...previous, ...origins])] })
      }
      await chrome.storage.session.remove(key)
      button.disabled = true
      result.textContent = 'Allowed. Connecting…'
      report(true)
    } catch (e) {
      result.textContent = e.message
    }
  })
}
