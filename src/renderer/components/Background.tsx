import { useStore } from '../lib/store'
import { mediaUrl } from '../lib/format'

const PRESETS: Record<string, string> = {
  aurora:
    'radial-gradient(1100px 520px at 15% -10%, rgb(62 224 143 / 0.16), transparent 60%), radial-gradient(900px 500px at 95% 5%, rgb(56 200 245 / 0.14), transparent 60%)',
  nebula:
    'radial-gradient(900px 700px at 85% 5%, rgb(157 107 255 / 0.22), transparent 60%), radial-gradient(800px 600px at 0% 100%, rgb(255 79 123 / 0.12), transparent 60%)',
  sunset:
    'radial-gradient(1000px 600px at 0% 0%, rgb(255 107 44 / 0.2), transparent 60%), radial-gradient(900px 600px at 100% 100%, rgb(255 79 123 / 0.16), transparent 60%)',
  ocean:
    'radial-gradient(1000px 700px at 100% 0%, rgb(56 200 245 / 0.18), transparent 60%), radial-gradient(900px 600px at 0% 100%, rgb(91 124 255 / 0.14), transparent 60%)'
}

/** Full-window backdrop behind the app chrome. */
export function Background() {
  const a = useStore((s) => s.settings.appearance)
  if (a.background === 'none') return null

  if (a.background === 'image' && a.backgroundImage) {
    return (
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -inset-16 bg-cover bg-center"
          style={{ backgroundImage: `url("${mediaUrl(a.backgroundImage)}")`, filter: `blur(${a.backgroundBlur}px)` }}
        />
        <div className="absolute inset-0 bg-bg" style={{ opacity: a.backgroundDim / 100 }} />
      </div>
    )
  }

  if (a.background === 'observatory' || !PRESETS[a.background]) {
    // Night sky: sparse stars, an accent "sun" glow sitting just above the zenith, and a faint horizon arc.
    return (
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="starfield absolute inset-0 opacity-70" />
        <div
          className="absolute left-1/2 top-[-55vh] h-[80vh] w-[120vw] -translate-x-1/2 rounded-[50%]"
          style={{ background: 'radial-gradient(closest-side, rgb(var(--accent) / 0.16), rgb(var(--accent) / 0.04) 60%, transparent)' }}
        />
        <div
          className="absolute left-1/2 top-[18vh] h-[180vh] w-[180vw] -translate-x-1/2 rounded-[50%] border-t border-line/[0.06]"
          style={{ boxShadow: 'inset 0 1px 60px -20px rgb(var(--accent) / 0.15)' }}
        />
      </div>
    )
  }

  return <div className="pointer-events-none fixed inset-0" style={{ backgroundImage: PRESETS[a.background] }} />
}
