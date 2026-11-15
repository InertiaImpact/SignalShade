import { useLayoutEffect, useRef, useState } from 'react'
import type { Workspace } from '../core/types'
import { customViewKey, deviceViewKey, gangViewKey } from '../core/views'

function readLocation(key: string) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function saveLocation(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Navigation still works if the browser blocks session storage.
  }
}

export function useDeskLocation(workspace: Workspace, workspaceId: string, ready: boolean) {
  const paneRef = useRef<HTMLElement>(null)
  const viewKey = `signalshade:last-view:${workspaceId}`
  const [lastChoice, setLastChoice] = useState<{ workspaceId: string; view: string }>()
  const requested =
    lastChoice?.workspaceId === workspaceId ? lastChoice.view : readLocation(viewKey)
  const valid =
    requested === 'favorites' ||
    workspace.views?.some((item) => customViewKey(item.id) === requested) ||
    workspace.gangs.some((item) => gangViewKey(item.id) === requested) ||
    workspace.devices.some((item) => deviceViewKey(item.id) === requested)
  const view = ready && requested && valid ? requested : 'all'

  useLayoutEffect(() => {
    const previous = history.scrollRestoration
    history.scrollRestoration = 'manual'
    return () => {
      history.scrollRestoration = previous
    }
  }, [])

  useLayoutEffect(() => {
    if (!ready || !paneRef.current) return
    const pane = paneRef.current
    const mobile = matchMedia('(max-width: 560px)')
    const scrollKey = `signalshade:desk-scroll:${workspaceId}:${view}`
    saveLocation(viewKey, view)
    const stored = Number(readLocation(scrollKey))
    const offset = Number.isFinite(stored) && stored > 0 ? stored : 0
    const scrollPosition = () => (mobile.matches ? window.scrollY : pane.scrollTop)
    const restoreOffset = (top: number) => {
      if (mobile.matches) window.scrollTo(0, top)
      else pane.scrollTop = top
    }
    restoreOffset(offset)
    let latest = scrollPosition()
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => saveLocation(scrollKey, String(latest))
    const track = () => {
      latest = scrollPosition()
      clearTimeout(timer)
      timer = setTimeout(save, 120)
    }
    const pageHide = () => {
      latest = scrollPosition()
      save()
    }
    const changeViewport = () => {
      restoreOffset(latest)
      track()
    }
    pane.addEventListener('scroll', track, { passive: true })
    window.addEventListener('scroll', track, { passive: true })
    window.addEventListener('pagehide', pageHide)
    mobile.addEventListener('change', changeViewport)
    return () => {
      clearTimeout(timer)
      save()
      pane.removeEventListener('scroll', track)
      window.removeEventListener('scroll', track)
      window.removeEventListener('pagehide', pageHide)
      mobile.removeEventListener('change', changeViewport)
    }
  }, [ready, view, viewKey, workspaceId])

  return {
    view,
    paneRef,
    setView: (next: string) => setLastChoice({ workspaceId, view: next }),
  }
}
