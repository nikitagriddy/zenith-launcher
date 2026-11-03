import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '../lib/format'

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl'
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onMouseDown={onClose} />
      <div
        className={cx(
          'glass relative flex max-h-[calc(100vh-80px)] w-full flex-col overflow-hidden rounded-3xl shadow-2xl shadow-black/50 animate-pop-in',
          width
        )}
        role="dialog"
        aria-modal
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/[0.07] px-6 py-5">
          <div className="min-w-0">
            <div className="font-display text-lg font-semibold tracking-tight">{title}</div>
            {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
          </div>
          <button className="btn-icon -mr-2 -mt-1" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line/[0.07] bg-bg/30 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
