import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import type { Game, LaunchPlan, LaunchProfileId } from '@shared/types'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { cx } from '../lib/format'
import { MODES, effectiveMode } from '../lib/modes'
import { Checkbox } from './controls'

/** Popover under the Play button: pick a launch mode for this launch, optionally remember it. */
export function LaunchModePicker({ game, anchor, onClose }: { game: Game; anchor: HTMLElement; onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const { launch, attempt } = useStore.getState()
  const [plans, setPlans] = useState<Record<LaunchProfileId, LaunchPlan> | null>(null)
  const current = effectiveMode(game, settings)
  const [hover, setHover] = useState<LaunchProfileId>(current)
  const [remember, setRemember] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  useEffect(() => {
    let alive = true
    api.games.launchPlans(game.id).then((p) => alive && setPlans(p), () => undefined)
    return () => {
      alive = false
    }
  }, [game.id, settings.launch])

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    const w = ref.current?.offsetWidth ?? 400
    const h = Math.min(ref.current?.scrollHeight ?? 420, window.innerHeight - 16)
    // Below the button if it fits, else above, else pinned to the window so the whole menu stays reachable.
    const top =
      r.bottom + 8 + h <= window.innerHeight ? r.bottom + 8 : r.top - h - 8 >= 8 ? r.top - h - 8 : Math.max(8, window.innerHeight - h - 8)
    setPos({ left: Math.min(Math.max(8, r.left), window.innerWidth - w - 8), top })
  }, [anchor, plans])

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])

  const pick = async (id: LaunchProfileId) => {
    onClose()
    if (remember && game.launchProfile !== id) await attempt(() => api.games.update(game.id, { launchProfile: id }), 'Could not save launch mode')
    await launch(game.id, id)
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="glass fixed z-[80] w-[400px] overflow-y-auto rounded-2xl !bg-surface/95 shadow-2xl shadow-black/50 animate-pop-in"
      style={{ ...pos, maxHeight: 'calc(100vh - 16px)' }}
    >
      <div className="px-4 pb-2 pt-3.5 text-sm font-semibold">Launch {game.title}</div>
      <div className="px-2">
        {MODES.map((m) => {
          const p = plans?.[m.id]
          const blocked = !!p && m.id !== 'default' && p.applies.length === 0
          return (
            <button
              key={m.id}
              role="menuitem"
              onMouseEnter={() => setHover(m.id)}
              onFocus={() => setHover(m.id)}
              onClick={() => void pick(m.id)}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
                hover === m.id ? 'bg-accent/[0.12]' : 'hover:bg-line/[0.05]'
              )}
            >
              <span
                className={cx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1',
                  m.id === current ? 'bg-accent text-on-accent ring-accent' : 'bg-line/[0.05] text-fg ring-line/10'
                )}
              >
                <m.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {m.name}
                  {m.id === current && <span className="text-[11px] font-medium text-accent">{game.launchProfile ? 'Saved for this game' : 'Used by Play'}</span>}
                </span>
                <span className={cx('block truncate text-xs', blocked ? 'text-amber-400' : 'text-muted')}>
                  {p ? (m.id === 'default' ? m.tagline : p.summary) : m.tagline}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2 border-t border-line/[0.07] bg-bg/40 px-4 py-3">
        {!plans ? (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking what this game supports…
          </div>
        ) : (
          // Every mode's list shares one grid cell, so the menu is always as tall as the longest and never moves under the mouse.
          <div className="grid">
            {MODES.map((m) => (
              <ul key={m.id} className={cx('col-start-1 row-start-1 space-y-1', m.id !== hover && 'invisible')}>
                {plans[m.id].applies.map((a) => (
                  <li key={a} className="flex gap-2 text-xs text-fg/85">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    {a}
                  </li>
                ))}
                {plans[m.id].limits.map((l) => (
                  <li key={l} className="flex gap-2 text-xs text-amber-300/90">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {l}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        )}
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-xs text-muted">
          <Checkbox checked={remember} onChange={setRemember} />
          Always launch {game.title} this way
        </label>
      </div>
    </div>,
    document.body
  )
}
