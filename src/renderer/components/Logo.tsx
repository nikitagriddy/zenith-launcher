import { useId } from 'react'

/**
 * Zenith mark: the sun at the point directly overhead, measured down to an observer on the horizon.
 * Same drawing as build/logo.svg, but the sun follows the user's accent colour.
 */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <clipPath id={`${id}t`}>
          <rect width="64" height="64" rx="14" />
        </clipPath>
        <radialGradient id={`${id}g`} cx="50%" cy="0%" r="80%">
          <stop offset="0" stopColor="rgb(var(--accent))" stopOpacity=".42" />
          <stop offset=".6" stopColor="rgb(var(--accent))" stopOpacity=".06" />
          <stop offset="1" stopColor="rgb(var(--accent))" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}s`} cx="50%" cy="80%" r="75%">
          <stop offset="0" stopColor="rgb(var(--accent-2))" />
          <stop offset=".5" stopColor="rgb(var(--accent))" />
          <stop offset="1" stopColor="rgb(var(--accent))" stopOpacity=".85" />
        </radialGradient>
        <linearGradient id={`${id}e`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2029" />
          <stop offset="1" stopColor="#0c0e13" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}t)`}>
        <rect width="64" height="64" fill="#0c0e13" />
        <rect width="64" height="64" fill={`url(#${id}g)`} />
        <circle cx="32" cy="0" r="27" fill="none" stroke="rgb(var(--accent))" strokeOpacity=".28" strokeWidth="1.2" />
        <circle cx="32" cy="0" r="19" fill={`url(#${id}s)`} />
        <path d="M32 25 V47" stroke="#ede5d6" strokeWidth="1.8" strokeDasharray="2 3" strokeLinecap="round" opacity=".65" />
        <path d="M-10 54 Q32 40 74 54 V70 H-10 Z" fill={`url(#${id}e)`} />
        <path d="M-10 54 Q32 40 74 54" fill="none" stroke="#ede5d6" strokeWidth="2.6" />
        <circle cx="32" cy="47" r="2.2" fill="#ede5d6" />
      </g>
    </svg>
  )
}

/** Lowercase "zenith" whose i is dotted with the sun, sitting straight above the stem. */
export function Wordmark({ size = 17, mark = true }: { size?: number; mark?: boolean }) {
  const dot = size * 0.21
  return (
    <div className="flex items-center gap-2.5" aria-label="Zenith">
      {mark && <LogoMark size={Math.round(size * 1.5)} />}
      <span className="font-display font-bold leading-none tracking-[-0.01em] text-fg" style={{ fontSize: size }} aria-hidden>
        zen
        <span className="relative inline-block">
          ı
          <span
            className="absolute left-1/2 -translate-x-1/2 rounded-full"
            style={{
              width: dot,
              height: dot,
              top: -size * 0.07,
              background: 'radial-gradient(circle at 50% 70%, rgb(var(--accent-2)), rgb(var(--accent)) 60%)',
              boxShadow: `0 0 ${size * 0.4}px rgb(var(--accent) / 0.55)`
            }}
          />
        </span>
        th
      </span>
    </div>
  )
}
