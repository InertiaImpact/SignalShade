import { useRef, useState, type PointerEvent, type MouseEvent } from 'react'
import { combineSelection, intersects, selectionRect, type SelectionRect } from '../core/selection'

/** Header/background gestures select cards. Inputs and other card actions never start selection. */
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
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button !== 0 || e.pointerType !== 'mouse') return
      const target = e.target as HTMLElement
      if (
        target.closest(
          'input, select, summary, a, .card-edit, .card-parameters, .card-bottom, .add-channel-card',
        ) ||
        (target.closest('button') && !target.closest('.card-select'))
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
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
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
    onPointerUp(e: PointerEvent<HTMLDivElement>) {
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
    },
    onClickCapture(e: MouseEvent<HTMLDivElement>) {
      if (suppressClick.current && e.detail > 0) {
        e.stopPropagation()
        e.preventDefault()
      }
      suppressClick.current = false
    },
  }
}
