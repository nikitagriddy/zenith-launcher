/** Zenith mark: a horizon arc with the sun at its highest point, framed in a rounded square. */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="rgb(var(--accent))" />
      <path d="M10 46 A22 22 0 0 1 54 46" fill="none" stroke="rgb(var(--on-accent))" strokeWidth="5" strokeLinecap="round" />
      <line x1="32" y1="46" x2="32" y2="27" stroke="rgb(var(--on-accent))" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.55" />
      <circle cx="32" cy="16" r="6" fill="rgb(var(--on-accent))" />
    </svg>
  )
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={24} />
      {!compact && <span className="font-display text-[15px] font-bold tracking-[0.32em] text-fg">ZENITH</span>}
    </div>
  )
}
