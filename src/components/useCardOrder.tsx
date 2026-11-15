import { useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { GripVertical } from 'lucide-react'

export function useCardOrder(
  ids: string[],
  enabled: boolean,
  move: (id: string, target: string) => void,
) {
  const [dragged, setDragged] = useState<string>()
  const [target, setTarget] = useState<string>()
  const touchPointer = useRef<number | undefined>(undefined)
  const clear = () => {
    touchPointer.current = undefined
    setDragged(undefined)
    setTarget(undefined)
  }
  const card = (element: Element | null) => {
    const item = element?.closest<HTMLElement>('[data-selection-id], [data-spacer-id]')
    return item?.dataset.selectionId ?? item?.dataset.spacerId
  }
  const touchTarget = (event: PointerEvent<HTMLElement>) =>
    card(document.elementFromPoint(event.clientX, event.clientY))
  return {
    target: enabled ? target : undefined,
    grip(id: string, label: string) {
      if (!enabled || ids.length < 2) return
      return (
        <button
          type="button"
          className="icon-button card-grip"
          aria-label={`Reorder ${label}`}
          title="Drag to reorder or use the arrow keys"
          draggable
          onPointerDown={(event) => {
            if (event.pointerType !== 'touch' || !event.isPrimary) return
            event.currentTarget.setPointerCapture(event.pointerId)
            touchPointer.current = event.pointerId
          }}
          onPointerMove={(event) => {
            if (touchPointer.current !== event.pointerId) return
            const next = touchTarget(event)
            setTarget(next && next !== id && ids.includes(next) ? next : undefined)
          }}
          onPointerUp={(event) => {
            if (touchPointer.current !== event.pointerId) return
            const next = touchTarget(event)
            if (next && ids.includes(next)) move(id, next)
            clear()
          }}
          onLostPointerCapture={(event) => {
            if (touchPointer.current === event.pointerId) clear()
          }}
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', id)
            event.dataTransfer.effectAllowed = 'move'
            setDragged(id)
          }}
          onDragEnd={clear}
          onKeyDown={(event) => {
            const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key)
              ? -1
              : ['ArrowRight', 'ArrowDown'].includes(event.key)
                ? 1
                : 0
            if (!direction) return
            event.preventDefault()
            const next = ids[ids.indexOf(id) + direction]
            if (next) move(id, next)
          }}
        >
          <GripVertical size={15} />
        </button>
      )
    },
    handlers: {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!enabled || !dragged) return
        const id = card(event.target as Element)
        setTarget(id && id !== dragged && ids.includes(id) ? id : undefined)
        if (id && ids.includes(id)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(undefined)
      },
      onDrop(event: DragEvent<HTMLElement>) {
        const id = card(event.target as Element)
        if (!enabled || !dragged || !id || !ids.includes(id)) return
        event.preventDefault()
        move(dragged, id)
        clear()
      },
    },
  }
}
