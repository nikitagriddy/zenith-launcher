import { useEffect, useRef, useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import { api } from './lib/api'
import { useStore } from './lib/store'
import { applyAppearance } from './lib/theme'
import { Background } from './components/Background'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { ConfirmDialog, ContextMenu, Toasts } from './components/Overlays'
import { GameEditor } from './components/GameEditor'
import { ScanModal } from './components/ScanModal'
import { LogoMark, Wordmark } from './components/Logo'
import { HomePage } from './pages/Home'
import { LibraryPage } from './pages/Library'
import { GameDetailsPage } from './pages/GameDetails'
import { StatsPage } from './pages/Stats'
import { DealsPage } from './pages/Deals'
import { SettingsPage } from './pages/Settings'

const LAUNCHABLE = /\.(exe|lnk|url|bat|cmd)$/i

function Splash({ error }: { error: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-bg">
      <LogoMark size={64} className={error ? '' : 'animate-pulse'} />
      <Wordmark size={22} mark={false} />
      {error && (
        <div className="max-w-md text-center text-sm text-red-400">
          Could not load your library: {error}
          <div className="mt-4">
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Page() {
  const route = useStore((s) => s.route)
  const key = route.page === 'game' ? `game-${route.id}` : route.page === 'settings' ? 'settings' : route.page
  let content
  switch (route.page) {
    case 'home':
      content = <HomePage />
      break
    case 'library':
      content = <LibraryPage route={route} />
      break
    case 'game':
      content = <GameDetailsPage id={route.id} />
      break
    case 'stats':
      content = <StatsPage />
      break
    case 'deals':
      content = <DealsPage />
      break
    case 'settings':
      content = <SettingsPage tab={route.tab} />
      break
  }
  return (
    <div key={key} className="min-h-full animate-page-in">
      {content}
    </div>
  )
}

export default function App() {
  const booted = useStore((s) => s.booted)
  const settings = useStore((s) => s.settings)
  const route = useStore((s) => s.route)
  const [bootError, setBootError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const scrollRef = useRef<HTMLElement>(null)

  useEffect(() => {
    useStore
      .getState()
      .boot()
      .catch((err) => setBootError((err as Error).message))
  }, [])

  useEffect(() => applyAppearance(settings), [settings])

  // Scroll to top on navigation.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [route])

  // Global keyboard + mouse navigation.
  useEffect(() => {
    const s = useStore.getState
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')
      const modalOpen = s().editor.open || s().scanOpen || !!s().confirm
      if (e.ctrlKey && !e.altKey && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault()
        s().focusSearch()
      } else if (e.ctrlKey && e.key === 'n' && !modalOpen) {
        e.preventDefault()
        s().openEditor()
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's' && !modalOpen) {
        e.preventDefault()
        s().setScanOpen(true)
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        s().navigate({ page: 'settings' })
      } else if (e.ctrlKey && ['1', '2', '3', '4'].includes(e.key) && !modalOpen) {
        e.preventDefault()
        s().navigate({ page: (['home', 'library', 'deals', 'stats'] as const)[Number(e.key) - 1]! })
      } else if (e.altKey && e.key === 'ArrowLeft' && !typing) {
        e.preventDefault()
        s().goBack()
      } else if (e.altKey && e.key === 'ArrowRight' && !typing) {
        e.preventDefault()
        s().goForward()
      } else if (e.key === 'Escape' && !modalOpen && s().search && !typing) {
        s().setSearch('')
      }
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) s().goBack()
      if (e.button === 4) s().goForward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])

  // Drag & drop an .exe / shortcut anywhere to add it.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const onOver = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      const p = api.files.pathForFile(file)
      if (!p || !LAUNCHABLE.test(p)) {
        useStore.getState().toast('error', 'Not a game file', 'Drop an .exe, .lnk, .url or .bat file to add it.')
        return
      }
      useStore.getState().openEditor(undefined, { exePath: p })
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!booted) return <Splash error={bootError} />

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <Background />
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main ref={scrollRef} className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Page />
        </main>
      </div>
      <GameEditor />
      <ScanModal />
      <ConfirmDialog />
      <ContextMenu />
      <Toasts />
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-[90] flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-bg/80 backdrop-blur-md animate-fade-in">
          <div className="text-center">
            <FilePlus2 className="mx-auto h-12 w-12 text-accent" />
            <div className="display mt-4 text-2xl uppercase">Drop to add game</div>
            <div className="readout mt-2">.exe · .lnk · .url · .bat</div>
          </div>
        </div>
      )}
    </div>
  )
}
