;(() => {
  if (window !== window.top) return
  let active = 0
  window.addEventListener('message', async (event) => {
    const m = event.data
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      m?.source !== 'signalshade-site' ||
      m.protocol !== 1 ||
      typeof m.id !== 'string' ||
      m.id.length > 100 ||
      active >= 64
    )
      return
    active++
    try {
      const reply = await chrome.runtime.sendMessage(m)
      window.postMessage(
        { source: 'signalshade-connect', protocol: 1, id: m.id, ...reply },
        location.origin,
      )
    } catch {
      window.postMessage(
        {
          source: 'signalshade-connect',
          protocol: 1,
          id: m.id,
          ok: false,
          error: 'Connect was updated or disabled. Reload SignalShade and reconnect.',
        },
        location.origin,
      )
    } finally {
      active--
    }
  })
})()
