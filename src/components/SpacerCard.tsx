import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { MoveDiagonal, X } from 'lucide-react'
import type { ViewSpacer } from '../core/types'
import { maxBarHeight, maxSpacerRows, minBarHeight } from '../core/views'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
const initialGrid = { columns: 1, columnStep: 390, rowStep: 339, rowGap: 9 }
type GridSize = typeof initialGrid
type SpacerSize = Pick<ViewSpacer, 'columns' | 'height'>

export function useSpacerGrid(referenceCard: string | undefined) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(initialGrid)
  useLayoutEffect(() => {
    const grid = ref.current
    if (!grid) return
    const card = referenceCard
      ? [...grid.children].find(
          (item) => (item as HTMLElement).dataset.selectionId === referenceCard,
        )
      : undefined
    const measure = () => {
      const style = getComputedStyle(grid)
      const minColumn =
        parseFloat(style.getPropertyValue('--channel-card-min')) || initialGrid.columnStep
      const rowGap = parseFloat(style.rowGap) || 0
      const columnGap = parseFloat(style.columnGap) || 0
      // Count explicit columns from the grid width, excluding tracks implied by a stale span.
      const availableWidth = grid.getBoundingClientRect().width
      const columns = clamp(
        Math.floor((availableWidth + columnGap) / (minColumn + columnGap)),
        1,
        32,
      )
      const columnStep = (availableWidth + columnGap) / columns
      const rowStep =
        (card?.getBoundingClientRect().height || initialGrid.rowStep - initialGrid.rowGap) + rowGap
      setSize((prev) =>
        prev.columns === columns &&
        prev.columnStep === columnStep &&
        prev.rowStep === rowStep &&
        prev.rowGap === rowGap
          ? prev
          : { columns, columnStep, rowStep, rowGap },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    if (card) observer.observe(card)
    return () => observer.disconnect()
  }, [referenceCard])
  return { ref, size }
}

export function SpacerCard({
  spacer,
  grid,
  grip,
  editable,
  dropTarget,
  resize,
  remove,
}: {
  spacer: ViewSpacer
  grid: GridSize
  grip: ReactNode
  editable: boolean
  dropTarget: boolean
  resize: (size: SpacerSize) => void
  remove: () => void
}) {
  const [preview, setPreview] = useState<SpacerSize>()
  const drag = useRef<{ x: number; y: number; grid: GridSize }>(undefined)
  const bar = spacer.kind === 'bar'
  const label = bar ? 'Spacer bar' : 'Blank card'
  const span = (size: SpacerSize, columns: number) => Math.min(size.columns ?? columns, columns)
  const dimensions = (dx: number, dy: number, sizing: GridSize): SpacerSize => {
    const original = span(spacer, sizing.columns)
    const width = clamp(original + Math.round(dx / sizing.columnStep), 1, sizing.columns)
    const height = bar
      ? clamp(spacer.height + Math.round(dy), minBarHeight, maxBarHeight)
      : clamp(spacer.height + Math.round(dy / sizing.rowStep), 1, maxSpacerRows)
    return { columns: width === original ? spacer.columns : width, height }
  }
  const fromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current
    return start && dimensions(event.clientX - start.x, event.clientY - start.y, start.grid)
  }
  const finish = () => {
    drag.current = undefined
    setPreview(undefined)
  }
  const size = preview ?? spacer
  return (
    <article
      className={`view-spacer ${bar ? 'spacer-bar' : ''} ${dropTarget ? 'card-drop-target' : ''}`}
      aria-label={label}
      data-spacer-id={spacer.id}
      style={{
        gridColumn: size.columns === undefined ? '1 / -1' : `span ${span(size, grid.columns)}`,
        gridRow: bar ? undefined : `span ${size.height}`,
        height: bar ? size.height : size.height * grid.rowStep - grid.rowGap,
      }}
    >
      {editable && (
        <div className="spacer-actions">
          {grip}
          <button
            className="icon-button"
            type="button"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={remove}
          >
            <X size={14} />
          </button>
          <button
            className="icon-button spacer-resize"
            type="button"
            aria-label={`Resize ${label.toLowerCase()}`}
            title="Drag to resize or use the arrow keys"
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { x: event.clientX, y: event.clientY, grid }
            }}
            onPointerMove={(event) => {
              const next = fromPointer(event)
              if (next) setPreview(next)
            }}
            onPointerUp={(event) => {
              const next = fromPointer(event)
              if (next && (next.columns !== spacer.columns || next.height !== spacer.height))
                resize(next)
              finish()
            }}
            onLostPointerCapture={finish}
            onKeyDown={(event) => {
              const x = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
              const y = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
              if (!x && !y) return
              event.preventDefault()
              resize(dimensions(x * grid.columnStep, y * (bar ? 4 : grid.rowStep), grid))
            }}
          >
            <MoveDiagonal size={14} />
          </button>
        </div>
      )}
    </article>
  )
}
