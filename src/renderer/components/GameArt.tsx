import { useState } from 'react'
import type { Game } from '@shared/types'
import { cx, hueFrom, mediaUrl } from '../lib/format'

/** Generated cover for games without artwork: deep two-tone sky, horizon arc, big monogram. */
function GeneratedCover({ game, variant }: { game: Pick<Game, 'title' | 'icon'>; variant: 'portrait' | 'landscape' }) {
  const h = hueFrom(game.title)
  const words = game.title.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  const mono = (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)).toUpperCase()
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: `linear-gradient(165deg, hsl(${h} 45% 20%), hsl(${(h + 40) % 360} 55% 7%) 70%)` }}
    >
      <div className="starfield absolute inset-0 opacity-60" style={{ backgroundSize: '260px 300px' }} />
      <div
        className="absolute left-1/2 aspect-square w-[170%] -translate-x-1/2 rounded-full border-t"
        style={{
          top: variant === 'portrait' ? '58%' : '62%',
          borderColor: `hsl(${h} 90% 70% / 0.45)`,
          boxShadow: `0 -30px 80px -30px hsl(${h} 90% 60% / 0.55)`
        }}
      />
      {game.icon ? (
        <img
          src={mediaUrl(game.icon)}
          className={cx('absolute left-1/2 -translate-x-1/2 drop-shadow-2xl', variant === 'portrait' ? 'top-[30%] h-14 w-14' : 'top-[22%] h-12 w-12')}
          style={{ imageRendering: 'auto' }}
          alt=""
          draggable={false}
        />
      ) : (
        <div
          className={cx(
            'absolute left-1/2 -translate-x-1/2 font-display font-bold tracking-tight',
            variant === 'portrait' ? 'top-[26%] text-5xl' : 'top-[18%] text-4xl'
          )}
          style={{ color: `hsl(${h} 70% 82% / 0.9)` }}
        >
          {mono}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-3">
        <div className="line-clamp-2 font-display text-[13px] font-semibold uppercase leading-tight tracking-wide text-white/90">
          {game.title}
        </div>
      </div>
    </div>
  )
}

export function GameCover({
  game,
  variant = 'portrait',
  className,
  imgClassName
}: {
  game: Pick<Game, 'title' | 'icon' | 'cover' | 'hero'>
  variant?: 'portrait' | 'landscape'
  className?: string
  imgClassName?: string
}) {
  const src = variant === 'landscape' ? game.hero || game.cover : game.cover
  const [failed, setFailed] = useState<string | null>(null)
  const ok = src && failed !== src
  return (
    <div className={cx('relative overflow-hidden bg-elevated', className)}>
      {ok ? (
        <img
          src={mediaUrl(src)}
          onError={() => setFailed(src)}
          className={cx('cover-img absolute inset-0 h-full w-full object-cover', imgClassName)}
          alt=""
          draggable={false}
        />
      ) : (
        <div className={cx('cover-img absolute inset-0', imgClassName)}>
          <GeneratedCover game={game} variant={variant} />
        </div>
      )}
    </div>
  )
}

export function GameIcon({ game, size = 40, className }: { game: Pick<Game, 'title' | 'icon' | 'cover'>; size?: number; className?: string }) {
  const h = hueFrom(game.title)
  if (game.icon || game.cover) {
    return (
      <div className={cx('shrink-0 overflow-hidden rounded-lg bg-elevated ring-1 ring-line/10', className)} style={{ width: size, height: size }}>
        <img src={mediaUrl(game.icon || game.cover)} className={cx('h-full w-full', game.icon ? 'object-contain p-1' : 'object-cover')} alt="" draggable={false} />
      </div>
    )
  }
  return (
    <div
      className={cx('flex shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white/90 ring-1 ring-line/10', className)}
      style={{ width: size, height: size, background: `linear-gradient(150deg, hsl(${h} 50% 32%), hsl(${(h + 40) % 360} 55% 14%))` }}
    >
      {game.title.slice(0, 2).toUpperCase()}
    </div>
  )
}

/** Blurred, scaled artwork used as an ambient backdrop behind hero sections. */
export function AmbientArt({ game, className }: { game: Pick<Game, 'title' | 'cover' | 'hero'>; className?: string }) {
  const h = hueFrom(game.title)
  if (game.hero) {
    return <img src={mediaUrl(game.hero)} className={cx('absolute inset-0 h-full w-full object-cover', className)} alt="" draggable={false} />
  }
  if (game.cover) {
    return (
      <img
        src={mediaUrl(game.cover)}
        className={cx('absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl', className)}
        alt=""
        draggable={false}
      />
    )
  }
  return (
    <div
      className={cx('absolute inset-0', className)}
      style={{ background: `radial-gradient(900px 400px at 70% 30%, hsl(${h} 60% 30% / 0.8), transparent 70%), linear-gradient(120deg, hsl(${(h + 40) % 360} 40% 10%), transparent)` }}
    />
  )
}
