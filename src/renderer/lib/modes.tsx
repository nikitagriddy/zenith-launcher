import { Play, SlidersHorizontal, Zap } from 'lucide-react'
import type { Game, LaunchProfileId, Settings } from '@shared/types'

/** A potato: lumpy outline, a few eyes. Drawn to sit with lucide's 24px stroke icons. */
export function PotatoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M8.2 4.3c3.2-1.9 7.9-1.1 10.2 1.9 2.4 3.1 2.1 7.8-.8 11-2.8 3.1-7.6 3.9-10.7 1.7C3.6 16.7 3 12.2 4.6 8.7c.8-1.8 2-3.3 3.6-4.4Z" />
      <path d="M9.4 8.9h.01M14.6 8.1h.01M12.2 13.3h.01M8.6 14.9h.01" strokeWidth={2.8} />
    </svg>
  )
}

export const MODES: { id: LaunchProfileId; name: string; icon: React.ComponentType<{ className?: string }>; tagline: string }[] = [
  { id: 'default', name: 'Default', icon: Play, tagline: 'Exactly how the game is set up' },
  { id: 'boost', name: 'Boost', icon: Zap, tagline: 'Same graphics, more speed' },
  { id: 'potato', name: 'Potato', icon: PotatoIcon, tagline: 'Lowest graphics for the most FPS' },
  { id: 'custom', name: 'Custom', icon: SlidersHorizontal, tagline: 'Your own launch options' }
]

export const modeOf = (id: LaunchProfileId) => MODES.find((m) => m.id === id) ?? MODES[0]!

/** The mode Play uses for this game when nothing else is picked. */
export function effectiveMode(game: Game, settings: Settings): LaunchProfileId {
  return game.launchProfile || settings.launch.defaultProfile
}
