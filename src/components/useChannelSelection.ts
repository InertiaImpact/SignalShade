import { useRef, useState, type PointerEvent, type MouseEvent } from 'react'
import { combineSelection, intersects, selectionRect, type SelectionRect } from '../core/selection'

/** Pane backgrounds and card headers select cards; controls and the gang console are excluded. */
export function useChannelSelection(
  ids: string[],
  select: (ids: string[]) => void,
  click: (id: string, additive: boolean) => void,
) {
  const [rectangle, setRectangle] = useState<SelectionRect | null>(null)
  const [preview, setPreview] = useState<string[] | null>(null)
  const gesture = useRef<{
    x: number
    y: number
    base: string[]
    additive: boolean
    card?: string
    moved: boolean
    result?: string[]
  } | null>(null)
  const suppressClick = useRef(false)
  return {
    rectangle,
    preview,
    onPointerDown(e: PointerEvent<HTMLElement>) {
      suppressClick.current = false
      if (e.button !== 0 || e.pointerType !== 'mouse') return
      const target = e.target as HTMLElement
      if (
        target.closest(
          'input, select, textarea, label, summary, a, [contenteditable], [role="slider"], [role="tablist"], .gang-console, .gang-card, .card-edit, .card-parameters, .card-bottom, .add-channel-card',
        ) ||
        (target.closest('button') && !target.closest('.card-select'))
      )
        return
      // A native scrollbar is part of the pane, but must retain its normal drag behavior.
      const bounds = e.currentTarget.getBoundingClientRect()
      if (
        e.clientX >= bounds.left + e.currentTarget.clientWidth ||
        e.clientY >= bounds.top + e.currentTarget.clientHeight
      )
        return
      const card = target.closest<HTMLElement>('[data-channel-id]')
      gesture.current = {
        x: e.clientX,
        y: e.clientY,
        base: ids,
        additive: e.ctrlKey || e.metaKey,
        card: card?.dataset.channelId,
        moved: false,
      }
      suppressClick.current = false
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const g = gesture.current
      if (!g) return
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return
      g.moved = true
      const rect = selectionRect(g.x, g.y, e.clientX, e.clientY)
      setRectangle(rect)
      const hits = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-channel-id]')]
        .filter((el) => intersects(rect, el.getBoundingClientRect()))
        .map((el) => el.dataset.channelId!)
      g.result = combineSelection(g.base, hits, g.additive)
      setPreview(g.result)
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const g = gesture.current
      if (!g) return
      if (!g.moved) {
        if (g.card) click(g.card, g.additive)
        else if (!g.additive) select([])
      } else select(g.result ?? [])
      suppressClick.current = true
      gesture.current = null
      setRectangle(null)
      setPreview(null)
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId)
    },
    onPointerCancel() {
      gesture.current = null
      setRectangle(null)
      setPreview(null)
      suppressClick.current = false
    },
    onLostPointerCapture() {
      gesture.current = null
      setRectangle(null)
      setPreview(null)
    },
    onClickCapture(e: MouseEvent<HTMLElement>) {
      if (suppressClick.current && e.detail > 0) {
        e.stopPropagation()
        e.preventDefault()
      }
      suppressClick.current = false
    },
  }
}
