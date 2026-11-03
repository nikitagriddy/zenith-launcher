// Global overlays: toasts, confirm dialog and context menu.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { cx } from '../lib/format'
import { Modal } from './Modal'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return createPortal(
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[360px] flex-col gap-2.5">
      {toasts.map((t) => {
        const Icon = t.kind === 'error' ? AlertTriangle : t.kind === 'success' ? CheckCircle2 : Info
        return (
          <div
            key={t.id}
            className="glass !bg-surface/95 pointer-events-auto flex items-start gap-3 rounded-2xl p-4 shadow-2xl shadow-black/40 animate-slide-in-right"
          >
            <Icon
              className={cx(
                'mt-0.5 h-5 w-5 shrink-0',
                t.kind === 'error' ? 'text-red-400' : t.kind === 'success' ? 'text-emerald-400' : 'text-accent'
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t.title}</div>
              {t.message && <div className="mt-0.5 whitespace-pre-line break-words text-xs leading-relaxed text-muted">{t.message}</div>}
            </div>
            <button className="text-muted hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}

export function ConfirmDialog() {
  const confirm = useStore((s) => s.confirm)
  const resolve = useStore((s) => s.resolveConfirm)
  return (
    <Modal
      open={!!confirm}
      onClose={() => resolve(false)}
      title={confirm?.title ?? ''}
      width="max-w-md"
      footer={
        <>
          <button className="btn-ghost" onClick={() => resolve(false)}>
            Cancel
          </button>
          <button autoFocus className={confirm?.danger ? 'btn bg-red-500 text-white hover:bg-red-600' : 'btn-primary'} onClick={() => resolve(true)}>
            {confirm?.confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{confirm?.message}</p>
    </Modal>
  )
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu)
  const close = useStore((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8)
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu, close])

  if (!menu) return null
  return createPortal(
    <div
      ref={ref}
      className="glass !bg-surface/95 fixed z-[80] min-w-[220px] rounded-xl p-1.5 shadow-2xl shadow-black/50 animate-pop-in"
      style={{ left: pos.x || menu.x, top: pos.y || menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 h-px bg-line/[0.08]" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              close()
              item.onClick?.()
            }}
            className={cx(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-40',
              item.danger ? 'text-red-400 hover:bg-red-500/15' : 'text-fg/90 hover:bg-accent/15 hover:text-fg'
            )}
          >
            {item.icon ? <item.icon className="h-4 w-4 shrink-0 opacity-80" /> : <span className="w-4" />}
            <span className="flex-1">{item.label}</span>
            {item.checked && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
