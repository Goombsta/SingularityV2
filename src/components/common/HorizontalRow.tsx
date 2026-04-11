import { useRef, useState } from 'react'
import './HorizontalRow.css'

interface HorizontalRowProps {
  title: string
  children: React.ReactNode
  onSeeAll?: () => void
}

export default function HorizontalRow({ title, children, onSeeAll }: HorizontalRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false })
  const [dragging, setDragging] = useState(false)

  const scroll = (dir: 'left' | 'right') => {
    rowRef.current?.scrollBy({ left: dir === 'left' ? -640 : 640, behavior: 'smooth' })
  }

  // ── Mouse-drag scroll ────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    const el = rowRef.current
    if (!el) return
    e.preventDefault()
    dragState.current = { active: true, startX: e.clientX, scrollLeft: el.scrollLeft, moved: false }
    setDragging(true)
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current.active) return
    const el = rowRef.current
    if (!el) return
    const delta = e.clientX - dragState.current.startX
    if (Math.abs(delta) > 4) dragState.current.moved = true
    el.scrollLeft = dragState.current.scrollLeft - delta
  }

  const onMouseUp = () => {
    dragState.current.active = false
    setDragging(false)
  }

  // Prevent click-through when user just dragged
  const onClickCapture = (e: React.MouseEvent) => {
    if (dragState.current.moved) {
      e.stopPropagation()
      dragState.current.moved = false
    }
  }

  return (
    <section className="h-row">
      <div className="h-row-header">
        <h2 className="h-row-title">{title}</h2>
        {onSeeAll && <button className="see-all-btn" onClick={onSeeAll}>See all</button>}
      </div>

      <div className="h-row-track">
        <button className="h-row-arrow left" onClick={() => scroll('left')} aria-label="Scroll left">‹</button>

        <div
          className={`h-row-items ${dragging ? 'is-dragging' : ''}`}
          ref={rowRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onClickCapture={onClickCapture}
        >
          {children}
        </div>

        <button className="h-row-arrow right" onClick={() => scroll('right')} aria-label="Scroll right">›</button>
      </div>
    </section>
  )
}
