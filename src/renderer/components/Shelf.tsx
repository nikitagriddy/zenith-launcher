import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Horizontal, scrollable row of cards with an indexed header. */
export function Shelf({ index, title, action, children }: { index: string; title: string; action?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="animate-page-in">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="readout !text-accent">{index}</span>
          <h2 className="section-title">{title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {action}
          <button className="btn-icon h-8 w-8" onClick={() => scroll(-1)} aria-label="Scroll left">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="btn-icon h-8 w-8" onClick={() => scroll(1)} aria-label="Scroll right">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={ref} className="no-scrollbar stagger -mx-2 -my-3 flex gap-5 overflow-x-auto scroll-smooth px-2 py-3">
        {children}
      </div>
    </section>
  )
}
