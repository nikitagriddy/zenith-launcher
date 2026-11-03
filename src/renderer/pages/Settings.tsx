import { useEffect, useState, type ReactNode } from 'react'
import {
  Archive,
  Database,
  Download,
  FolderOpen,
  FolderPlus,
  HardDrive,
  ImageDown,
  Info,
  Keyboard,
  LibraryBig,
  Palette,
  Power,
  Radar,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { AppInfo, ArtworkProgress, BackgroundType, BackupEntry, Category, StorageInfo, ThemeName, UpdateInstallMode, UpdateStatus } from '@shared/types'
import { ACCENT_PRESETS } from '@shared/settings'
import { api } from '../lib/api'
import { useStore, type SettingsTab } from '../lib/store'
import { cx, formatBytes, formatDateTime } from '../lib/format'
import { Segmented, Select, SettingRow, Slider, Toggle } from '../components/controls'
import { LogoMark } from '../components/Logo'
import { useUpdateStatus } from '../lib/hooks'

const TABS: { id: SettingsTab; label: string; icon: typeof Info }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'library', label: 'Library', icon: LibraryBig },
  { id: 'scanning', label: 'Scanning', icon: Radar },
  { id: 'startup', label: 'Startup', icon: Power },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'data', label: 'Backup & data', icon: Database },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
  { id: 'about', label: 'About', icon: Info }
]

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="panel px-6 py-5 animate-page-in">
      <h2 className="section-title">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

// ---------------- General ----------------

const MOD_KEYS: Record<string, string> = { Control: 'Control', Alt: 'Alt', Shift: 'Shift', Meta: 'Super' }

function toAccelerator(e: KeyboardEvent): string | null {
  if (MOD_KEYS[e.key]) return null
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[]
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  if (e.code.startsWith('Key')) key = e.code.slice(3)
  else if (e.code.startsWith('Digit')) key = e.code.slice(5)
  else if (key === ' ') key = 'Space'
  else if (key.startsWith('Arrow')) key = key.slice(5)
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return null // require a modifier unless it's an F-key
  return [...mods, key].join('+')
}

function HotkeyRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false)
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(false)
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onChange('')
        return setRecording(false)
      }
      const acc = toAccelerator(e)
      if (acc) {
        onChange(acc)
        setRecording(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])
  return (
    <button
      onClick={() => setRecording((r) => !r)}
      className={cx(
        'num h-9 min-w-[170px] rounded-lg border px-3 text-xs transition-colors',
        recording ? 'animate-pulse border-accent bg-accent/10 text-accent' : 'border-line/[0.12] bg-bg/60 hover:border-line/25'
      )}
    >
      {recording ? 'Press keys… (Esc cancel)' : value ? value.replace(/\+/g, ' + ') : 'Not set'}
    </button>
  )
}

function GeneralTab() {
  const g = useStore((s) => s.settings.general)
  const update = useStore((s) => s.updateSettings)
  const set = (patch: Partial<typeof g>) => void update({ general: patch })
  return (
    <>
      <Card title="Behavior">
        <SettingRow title="Minimize Zenith when a game starts" description="Gets the launcher out of the way while you play.">
          <Toggle checked={g.minimizeOnLaunch} onChange={(v) => set({ minimizeOnLaunch: v })} />
        </SettingRow>
        <SettingRow title="Restore Zenith when a game closes">
          <Toggle checked={g.restoreAfterExit} onChange={(v) => set({ restoreAfterExit: v })} />
        </SettingRow>
        <SettingRow title="Close to system tray" description="The window close button hides Zenith to the tray. Playtime tracking keeps running.">
          <Toggle checked={g.closeToTray} onChange={(v) => set({ closeToTray: v })} />
        </SettingRow>
        <SettingRow title="Ask before removing games">
          <Toggle checked={g.confirmBeforeRemove} onChange={(v) => set({ confirmBeforeRemove: v })} />
        </SettingRow>
        <SettingRow title="Desktop notifications" description="Show a Windows notification for session results while Zenith is in the background.">
          <Toggle checked={g.showNotifications} onChange={(v) => set({ showNotifications: v })} />
        </SettingRow>
      </Card>
      <Card title="Global hotkey" description="Show or hide Zenith from anywhere in Windows. Backspace while recording clears it.">
        <SettingRow title="Toggle Zenith window">
          <HotkeyRecorder value={g.globalHotkey} onChange={(v) => set({ globalHotkey: v })} />
        </SettingRow>
      </Card>
    </>
  )
}

// ---------------- Appearance ----------------

const THEMES: { id: ThemeName; name: string; bg: string; surface: string; fg: string }[] = [
  { id: 'dark', name: 'Ink', bg: '#06080c', surface: '#0d1017', fg: '#ede7db' },
  { id: 'midnight', name: 'Void', bg: '#000000', surface: '#09090b', fg: '#f0ede6' },
  { id: 'slate', name: 'Dusk', bg: '#0d111b', surface: '#151b29', fg: '#e6eaf3' },
  { id: 'light', name: 'Paper', bg: '#efebe3', surface: '#faf8f3', fg: '#19160f' }
]

const BACKGROUNDS: { id: BackgroundType; name: string; css: string }[] = [
  { id: 'observatory', name: 'Observatory', css: 'radial-gradient(60% 50% at 50% 0%, rgb(var(--accent) / .45), transparent 70%), #06080c' },
  { id: 'aurora', name: 'Aurora', css: 'radial-gradient(70% 60% at 20% 0%, #3ee08f55, transparent), radial-gradient(60% 60% at 100% 10%, #38c8f555, transparent), #06080c' },
  { id: 'nebula', name: 'Nebula', css: 'radial-gradient(70% 60% at 90% 0%, #9d6bff66, transparent), radial-gradient(60% 60% at 0% 100%, #ff4f7b44, transparent), #06080c' },
  { id: 'sunset', name: 'Sunset', css: 'radial-gradient(70% 60% at 0% 0%, #ff6b2c66, transparent), radial-gradient(60% 60% at 100% 100%, #ff4f7b55, transparent), #06080c' },
  { id: 'ocean', name: 'Ocean', css: 'radial-gradient(70% 60% at 100% 0%, #38c8f566, transparent), radial-gradient(60% 60% at 0% 100%, #5b7cff44, transparent), #06080c' },
  { id: 'none', name: 'Plain', css: 'rgb(var(--bg))' },
  { id: 'image', name: 'Custom image', css: 'repeating-linear-gradient(45deg, rgb(var(--line) / .06) 0 8px, transparent 8px 16px), rgb(var(--surface))' }
]

function AppearanceTab() {
  const a = useStore((s) => s.settings.appearance)
  const { updateSettings, attempt } = useStore.getState()
  const set = (patch: Partial<typeof a>) => void updateSettings({ appearance: patch })

  const pickBackground = async () => {
    const p = await attempt(() => api.dialog.openFile({ title: 'Choose background image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'gif'] }] }))
    if (!p) return
    const name = await attempt(() => api.media.importFile(p, 'bg'), 'Could not use image')
    if (name) set({ background: 'image', backgroundImage: name })
  }

  return (
    <>
      <Card title="Theme">
        <div className="mt-3 grid grid-cols-4 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => set({ theme: t.id })}
              className={cx('overflow-hidden rounded-xl border-2 text-left transition-all', a.theme === t.id ? 'border-accent' : 'border-line/[0.08] hover:border-line/25')}
            >
              <div className="flex h-20 gap-1.5 p-2" style={{ background: t.bg }}>
                <div className="w-6 rounded" style={{ background: t.surface }} />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-2 w-3/5 rounded-sm" style={{ background: t.fg, opacity: 0.85 }} />
                  <div className="h-1.5 w-2/5 rounded-sm" style={{ background: t.fg, opacity: 0.35 }} />
                  <div className="mt-auto h-3 w-8 rounded-sm bg-accent" />
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-semibold">{t.name}</span>
                {a.theme === t.id && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Accent color" description="Drives buttons, highlights, charts and the logo.">
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c.hex}
              title={c.name}
              onClick={() => set({ accent: c.hex })}
              className={cx('group flex flex-col items-center gap-1.5')}
            >
              <span
                className={cx('block h-9 w-9 rounded-lg transition-transform group-hover:scale-110', a.accent.toLowerCase() === c.hex && 'ring-2 ring-fg ring-offset-2 ring-offset-surface')}
                style={{ background: c.hex }}
              />
              <span className="readout !text-[9px]">{c.name}</span>
            </button>
          ))}
          <label className="flex cursor-pointer flex-col items-center gap-1.5" title="Custom color">
            <span className="relative block h-9 w-9 overflow-hidden rounded-lg ring-1 ring-line/20" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
              <input type="color" value={a.accent} onChange={(e) => set({ accent: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </span>
            <span className="readout !text-[9px]">Custom</span>
          </label>
          <span className="num ml-2 rounded-md border border-line/10 px-2 py-1 text-xs">{a.accent.toUpperCase()}</span>
        </div>
      </Card>

      <Card title="Background">
        <div className="mt-3 grid grid-cols-7 gap-2.5">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              onClick={() => (b.id === 'image' && !a.backgroundImage ? void pickBackground() : set({ background: b.id }))}
              className={cx('overflow-hidden rounded-xl border-2 text-left transition-all', a.background === b.id ? 'border-accent' : 'border-line/[0.08] hover:border-line/25')}
            >
              <div className="h-14" style={{ background: b.css }} />
              <div className="px-2 py-1.5 text-[11px] font-semibold">{b.name}</div>
            </button>
          ))}
        </div>
        {a.background === 'image' && (
          <div className="mt-4 animate-fade-in">
            <SettingRow title="Image">
              <button className="btn-ghost h-8 text-xs" onClick={() => void pickBackground()}>
                <Upload className="h-3.5 w-3.5" /> Choose image
              </button>
            </SettingRow>
            <SettingRow title="Blur">
              <div className="w-56">
                <Slider value={a.backgroundBlur} min={0} max={60} onChange={(v) => set({ backgroundBlur: v })} format={(v) => `${v}px`} />
              </div>
            </SettingRow>
            <SettingRow title="Dim">
              <div className="w-56">
                <Slider value={a.backgroundDim} min={0} max={95} onChange={(v) => set({ backgroundDim: v })} format={(v) => `${v}%`} />
              </div>
            </SettingRow>
          </div>
        )}
      </Card>

      <Card title="Interface">
        <SettingRow title="Animations" description="Page transitions, hover motion and reveal effects.">
          <Toggle checked={a.animations} onChange={(v) => set({ animations: v })} />
        </SettingRow>
        <SettingRow title="Glass effects" description="Translucent, blurred panels. Turn off on slower GPUs.">
          <Toggle checked={a.glass} onChange={(v) => set({ glass: v })} />
        </SettingRow>
        <SettingRow title="Film grain" description="Subtle noise texture across the interface.">
          <Toggle checked={a.grain} onChange={(v) => set({ grain: v })} />
        </SettingRow>
        <SettingRow title="Interface scale">
          <div className="w-56">
            <Slider value={a.uiScale} min={80} max={130} step={5} onChange={(v) => set({ uiScale: v })} format={(v) => `${v}%`} />
          </div>
        </SettingRow>
      </Card>

      <Card title="Sidebar">
        <SettingRow title="Style">
          <Segmented
            size="sm"
            value={a.sidebarStyle}
            onChange={(v) => set({ sidebarStyle: v })}
            options={[
              { value: 'glass', label: 'Glass' },
              { value: 'solid', label: 'Solid' },
              { value: 'floating', label: 'Floating' }
            ]}
          />
        </SettingRow>
        <SettingRow title="Collapsed" description="Icons only.">
          <Toggle checked={a.sidebarCollapsed} onChange={(v) => set({ sidebarCollapsed: v })} />
        </SettingRow>
        <SettingRow title="Show collections">
          <Toggle checked={a.sidebarShowCategories} onChange={(v) => set({ sidebarShowCategories: v })} />
        </SettingRow>
        <SettingRow title="Show favorites">
          <Toggle checked={a.sidebarShowFavorites} onChange={(v) => set({ sidebarShowFavorites: v })} />
        </SettingRow>
      </Card>
    </>
  )
}

// ---------------- Library ----------------

function CategoryRow({ c, count }: { c: Category; count: number }) {
  const { attempt, ask } = useStore.getState()
  const [name, setName] = useState(c.name)
  useEffect(() => setName(c.name), [c.name])
  const save = (patch: Partial<Category>) => void attempt(() => api.categories.update(c.id, patch), 'Could not update collection')
  return (
    <div className="flex items-center gap-3 border-b border-line/[0.06] py-2.5 last:border-0">
      <label className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-line/15" style={{ background: c.color }}>
        <input type="color" value={c.color} onChange={(e) => save({ color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <input
        className="input h-8 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== c.name && save({ name })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="num w-16 text-right text-xs text-muted">{count} games</span>
      <button
        className="btn-icon h-8 w-8 hover:!text-red-400"
        onClick={async () => {
          if (await ask({ title: `Delete “${c.name}”?`, message: 'Games in this collection stay in your library.', confirmLabel: 'Delete', danger: true })) {
            void attempt(() => api.categories.remove(c.id), 'Could not delete collection')
          }
        }}
        aria-label="Delete collection"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function ArtworkCard() {
  const auto = useStore((s) => s.settings.library.autoArtwork)
  const { updateSettings, attempt, toast } = useStore.getState()
  const [p, setP] = useState<ArtworkProgress | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => api.on('art:progress', (x: ArtworkProgress) => setP(x)), [])
  const runAll = async () => {
    setBusy(true)
    const r = await attempt(() => api.art.fetchAll(), 'Artwork lookup failed')
    setBusy(false)
    if (r) toast('success', `Artwork updated for ${r.updated} game${r.updated === 1 ? '' : 's'}`, `${r.checked} checked. Games that couldn't be matched keep their generated cover.`)
  }
  const active = busy && p && p.done < p.total
  return (
    <Card title="Artwork" description="Real cover art, banners and descriptions from the Epic catalog on this PC and the Steam store.">
      <SettingRow title="Download artwork automatically" description="For newly added games and any game still missing a cover.">
        <Toggle checked={auto} onChange={(v) => void updateSettings({ library: { autoArtwork: v } })} />
      </SettingRow>
      <SettingRow
        title="Find artwork for all games"
        description={active ? `${p!.done}/${p!.total} · ${p!.current}` : 'Fills missing covers, banners and descriptions. Your own images are never replaced.'}
      >
        <button className="btn-primary h-9" disabled={busy} onClick={() => void runAll()}>
          <ImageDown className={cx('h-4 w-4', busy && 'animate-pulse')} /> {busy ? 'Searching…' : 'Find artwork'}
        </button>
      </SettingRow>
      {active && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-line/[0.08]">
          <div className="h-full bg-accent transition-all" style={{ width: `${(p!.done / Math.max(1, p!.total)) * 100}%` }} />
        </div>
      )}
    </Card>
  )
}

const INSTALL_MODES: { value: UpdateInstallMode; title: string; text: string }[] = [
  { value: 'auto', title: 'Install automatically', text: 'Download in the background and restart into the new version as soon as it’s ready. Waits until your game closes.' },
  { value: 'quit', title: 'Install when I quit', text: 'Download in the background and install the next time you close Zenith.' },
  { value: 'manual', title: 'Ask me first', text: 'Tell me when an update is out. I’ll choose when to download and install it.' }
]

function UpdatesTab() {
  const u = useStore((s) => s.settings.updates)
  const { updateSettings, attempt } = useStore.getState()
  const st = useUpdateStatus()
  const set = (patch: Partial<typeof u>) => void updateSettings({ updates: patch })
  const busy = !st || ['checking', 'downloading', 'installing'].includes(st.state)

  const headline: Record<UpdateStatus['state'], string> = {
    idle: 'Not checked yet',
    checking: 'Checking for updates…',
    available: `Zenith ${st?.version ?? ''} is available`,
    downloading: `Downloading Zenith ${st?.version ?? ''}`,
    downloaded: st?.waitingForGames ? `Zenith ${st?.version ?? ''} installs when your game closes` : `Zenith ${st?.version ?? ''} is ready to install`,
    installing: `Restarting to install Zenith ${st?.version ?? ''}…`,
    none: 'You’re up to date',
    error: 'Update check failed',
    unsupported: 'Updates unavailable'
  }
  const sub =
    st?.state === 'error' || st?.state === 'unsupported'
      ? st.message
      : st?.checkedAt
        ? `Last checked ${formatDateTime(st.checkedAt)}`
        : undefined

  return (
    <>
      <section className="panel relative overflow-hidden p-6 animate-page-in">
        <div className="flex items-start gap-5">
          <div
            className={cx(
              'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1',
              st?.state === 'error' ? 'bg-red-500/10 text-red-400 ring-red-500/30' : 'bg-accent/10 text-accent ring-accent/25'
            )}
          >
            <RefreshCw className={cx('h-6 w-6', busy && st?.state !== 'installing' && 'animate-spin')} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="readout">Installed · v{st?.currentVersion ?? '…'}</div>
            <div className="mt-1 font-display text-lg font-semibold">{st ? headline[st.state] : '…'}</div>
            {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
          </div>
          <div className="flex shrink-0 gap-2">
            {st?.state === 'available' && (
              <button className="btn-primary" onClick={() => void attempt(() => api.update.download(), 'Download failed')}>
                <Download className="h-4 w-4" /> Download
              </button>
            )}
            {st?.state === 'downloaded' && (
              <button className="btn-primary" onClick={() => void attempt(() => api.update.install(), 'Could not install update')}>
                <RotateCcw className="h-4 w-4" /> Restart & install
              </button>
            )}
            {st?.state === 'installing' && (
              <button className="btn-ghost" onClick={() => void attempt(() => api.update.postpone())}>
                Later
              </button>
            )}
            {!['available', 'downloaded', 'installing'].includes(st?.state ?? '') && (
              <button className="btn-ghost" disabled={busy || st?.state === 'unsupported'} onClick={() => void attempt(() => api.update.check(), 'Update check failed')}>
                <RefreshCw className="h-4 w-4" /> Check now
              </button>
            )}
          </div>
        </div>
        {(st?.state === 'downloading' || st?.state === 'installing') && (
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-line/[0.08]">
            <div
              className={cx('h-full bg-accent transition-all duration-500', st.state === 'installing' && 'animate-pulse')}
              style={{ width: `${st.state === 'installing' ? 100 : (st.percent ?? 0)}%` }}
            />
          </div>
        )}
        {st?.notes && ['available', 'downloading', 'downloaded', 'installing'].includes(st.state) && (
          <div className="mt-5 rounded-xl border border-line/[0.08] bg-bg/40 p-4">
            <div className="readout mb-2">What’s new in {st.version}</div>
            <p className="max-h-40 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-fg/80">{st.notes}</p>
          </div>
        )}
      </section>

      <Card title="Automatic updates" description="Zenith updates itself from its GitHub releases. Nothing is sent about you or your library.">
        <SettingRow title="Check for updates automatically" description="On startup and on a schedule.">
          <Toggle checked={u.autoCheck} onChange={(v) => set({ autoCheck: v })} />
        </SettingRow>
        <SettingRow title="How often">
          <Select
            className="h-9 w-44"
            value={String(u.intervalHours)}
            onChange={(v) => set({ intervalHours: Number(v) })}
            options={[
              { value: '1', label: 'Every hour' },
              { value: '6', label: 'Every 6 hours' },
              { value: '24', label: 'Once a day' },
              { value: '168', label: 'Once a week' }
            ]}
          />
        </SettingRow>
        <div className="mt-3">
          <div className="readout mb-2">When an update is found</div>
          <div className="space-y-2">
            {INSTALL_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => set({ installMode: m.value })}
                className={cx(
                  'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                  u.installMode === m.value ? 'border-accent/60 bg-accent/[0.07]' : 'border-line/[0.08] hover:border-line/20'
                )}
              >
                <span
                  className={cx(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                    u.installMode === m.value ? 'border-accent' : 'border-line/30'
                  )}
                >
                  {u.installMode === m.value && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </span>
                <span>
                  <span className="block text-sm font-semibold">
                    {m.title}
                    {m.value === 'auto' && <span className="readout ml-2 !text-accent">Recommended</span>}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{m.text}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>
    </>
  )
}

function LibraryTab() {
  const l = useStore((s) => s.settings.library)
  const categories = useStore((s) => s.categories)
  const games = useStore((s) => s.games)
  const { updateSettings, attempt } = useStore.getState()
  const set = (patch: Partial<typeof l>) => void updateSettings({ library: patch })
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#ff6b2c')

  const create = async () => {
    if (!newName.trim()) return
    const c = await attempt(() => api.categories.create(newName.trim(), newColor), 'Could not create collection')
    if (c) setNewName('')
  }

  return (
    <>
      <Card title="Layout">
        <SettingRow title="Library layout">
          <Segmented
            size="sm"
            value={l.layout}
            onChange={(v) => set({ layout: v })}
            options={[
              { value: 'grid', label: 'Grid' },
              { value: 'compact', label: 'Compact' },
              { value: 'list', label: 'List' }
            ]}
          />
        </SettingRow>
        <SettingRow title="Grid card size">
          <div className="w-56">
            <Slider value={l.gridSize} min={130} max={320} step={10} onChange={(v) => set({ gridSize: v })} format={(v) => `${v}px`} />
          </div>
        </SettingRow>
        <SettingRow title="Show title & playtime under covers">
          <Toggle checked={l.showCardInfo} onChange={(v) => set({ showCardInfo: v })} />
        </SettingRow>
        <SettingRow title="Default sort">
          <Select
            className="h-9 w-48"
            value={l.sortBy}
            onChange={(v) => set({ sortBy: v })}
            options={[
              { value: 'name', label: 'Name' },
              { value: 'lastPlayed', label: 'Recently played' },
              { value: 'playtime', label: 'Playtime' },
              { value: 'added', label: 'Date added' }
            ]}
          />
        </SettingRow>
        <SettingRow title="Show games that aren’t installed" description="Games whose executable can’t be found on disk.">
          <Toggle checked={l.showNotInstalled} onChange={(v) => set({ showNotInstalled: v })} />
        </SettingRow>
        <SettingRow title="Show hidden games everywhere">
          <Toggle checked={l.showHidden} onChange={(v) => set({ showHidden: v })} />
        </SettingRow>
      </Card>

      <ArtworkCard />

      <Card title="Collections" description="Group games your way - genres, moods, co-op nights. A game can be in several.">
        <div className="mt-2">
          {categories.map((c) => (
            <CategoryRow key={c.id} c={c} count={games.filter((g) => g.categoryIds.includes(c.id)).length} />
          ))}
          <div className="mt-3 flex items-center gap-3">
            <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-line/15" style={{ background: newColor }}>
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <input className="input h-9 flex-1" placeholder="New collection name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
            <button className="btn-primary h-9" disabled={!newName.trim()} onClick={() => void create()}>
              Create
            </button>
          </div>
        </div>
      </Card>
    </>
  )
}

// ---------------- Scanning ----------------

function ScanningTab() {
  const sc = useStore((s) => s.settings.scanning)
  const { updateSettings, attempt, setScanOpen, toast } = useStore.getState()
  const set = (patch: Partial<typeof sc>) => void updateSettings({ scanning: patch })
  const [keywords, setKeywords] = useState(sc.excludeKeywords.join(', '))
  useEffect(() => setKeywords(sc.excludeKeywords.join(', ')), [sc.excludeKeywords])

  const add = async () => {
    const p = await attempt(() => api.dialog.openFolder('Add a game folder'))
    if (!p) return
    if (sc.folders.some((f) => f.toLowerCase() === p.toLowerCase())) return toast('info', 'Folder already added')
    set({ folders: [...sc.folders, p] })
  }

  return (
    <>
      <Card title="Game folders" description="Each sub-folder of these folders is treated as one game.">
        <div className="mt-3 space-y-1.5">
          {sc.folders.length === 0 && <div className="text-sm text-muted">No folders yet.</div>}
          {sc.folders.map((f) => (
            <div key={f} className="flex items-center gap-3 rounded-lg border border-line/[0.08] bg-bg/40 px-3 py-2">
              <FolderOpen className="h-4 w-4 text-accent" />
              <span className="flex-1 truncate font-mono text-xs">{f}</span>
              <button className="btn-icon h-7 w-7" onClick={() => set({ folders: sc.folders.filter((x) => x !== f) })} aria-label="Remove">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button className="btn-ghost" onClick={() => void add()}>
            <FolderPlus className="h-4 w-4" /> Add folder
          </button>
          <button className="btn-primary" onClick={() => setScanOpen(true)}>
            <Radar className="h-4 w-4" /> Scan now
          </button>
        </div>
      </Card>
      <Card title="Detection">
        <SettingRow title="Detect Steam games" description="Reads Steam library manifests and local artwork. Games launch through Steam.">
          <Toggle checked={sc.detectSteam} onChange={(v) => set({ detectSteam: v })} />
        </SettingRow>
        <SettingRow title="Detect Epic Games" description="Reads Epic Games Launcher install manifests.">
          <Toggle checked={sc.detectEpic} onChange={(v) => set({ detectEpic: v })} />
        </SettingRow>
        <SettingRow title="Folder search depth" description="How many levels below each game folder to look for executables.">
          <div className="w-48">
            <Slider value={sc.depth} min={1} max={6} onChange={(v) => set({ depth: v })} />
          </div>
        </SettingRow>
        <SettingRow title="Ignore folders & files containing" description="Comma-separated keywords, e.g. demo, beta, mods">
          <input
            className="input h-9 w-64"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            onBlur={() => set({ excludeKeywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) })}
            placeholder="demo, test"
          />
        </SettingRow>
      </Card>
      <Card title="Automatic scanning">
        <SettingRow title="Scan when Zenith starts">
          <Toggle checked={sc.autoScanOnStartup} onChange={(v) => set({ autoScanOnStartup: v })} />
        </SettingRow>
        <SettingRow title="Scan periodically">
          <Select
            className="h-9 w-44"
            value={String(sc.autoScanIntervalMin)}
            onChange={(v) => set({ autoScanIntervalMin: Number(v) })}
            options={[
              { value: '0', label: 'Off' },
              { value: '15', label: 'Every 15 minutes' },
              { value: '60', label: 'Every hour' },
              { value: '360', label: 'Every 6 hours' },
              { value: '1440', label: 'Daily' }
            ]}
          />
        </SettingRow>
        <SettingRow title="Add new games automatically" description="Otherwise Zenith notifies you and waits for you to review them.">
          <Toggle checked={sc.autoImport} onChange={(v) => set({ autoImport: v })} />
        </SettingRow>
      </Card>
    </>
  )
}

// ---------------- Startup ----------------

function StartupTab() {
  const st = useStore((s) => s.settings.startup)
  const update = useStore((s) => s.updateSettings)
  const [packaged, setPackaged] = useState(true)
  useEffect(() => void api.app.info().then((i) => setPackaged(i.isPackaged)), [])
  const set = (patch: Partial<typeof st>) => void update({ startup: patch })
  return (
    <Card title="Startup">
      <SettingRow title="Launch Zenith when Windows starts" description={packaged ? undefined : 'Only applies to the installed app (not development builds).'}>
        <Toggle checked={st.launchOnLogin} onChange={(v) => set({ launchOnLogin: v })} />
      </SettingRow>
      <SettingRow title="Start minimized" description="Starts in the tray when launched at login, minimized otherwise.">
        <Toggle checked={st.startMinimized} onChange={(v) => set({ startMinimized: v })} />
      </SettingRow>
      <SettingRow title="Start page">
        <Segmented
          size="sm"
          value={st.startPage}
          onChange={(v) => set({ startPage: v })}
          options={[
            { value: 'home', label: 'Overview' },
            { value: 'library', label: 'Library' }
          ]}
        />
      </SettingRow>
    </Card>
  )
}

// ---------------- Storage ----------------

function StorageTab() {
  const { attempt, toast, ask } = useStore.getState()
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const load = () => void attempt(() => api.data.storageInfo()).then((i) => i && setInfo(i))
  useEffect(load, [attempt])

  const total = info ? info.dbBytes + info.mediaBytes + info.backupsBytes : 0
  const bars = info
    ? [
        { label: 'Library database', bytes: info.dbBytes, cls: 'bg-accent' },
        { label: `Artwork (${info.mediaFiles} files)`, bytes: info.mediaBytes, cls: 'bg-accent-2' },
        { label: 'Backups', bytes: info.backupsBytes, cls: 'bg-line/40' }
      ]
    : []

  return (
    <>
      <Card title="Local data" description="Everything Zenith knows lives on this PC. Nothing is uploaded anywhere.">
        {info ? (
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="num text-2xl font-semibold">{formatBytes(total)}</span>
              <button className="btn-ghost h-8 text-xs" onClick={() => void attempt(() => api.data.openDataFolder())}>
                <FolderOpen className="h-3.5 w-3.5" /> Open data folder
              </button>
            </div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-line/[0.06]">
              {bars.map((b) => (
                <span key={b.label} className={b.cls} style={{ width: `${total ? (b.bytes / total) * 100 : 0}%` }} />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {bars.map((b) => (
                <div key={b.label} className="flex items-center gap-2">
                  <span className={cx('h-2 w-2 rounded-sm', b.cls)} />
                  <span className="text-xs text-muted">{b.label}</span>
                  <span className="num ml-auto text-xs">{formatBytes(b.bytes)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 truncate font-mono text-[11px] text-muted">{info.dataDir}</div>
          </div>
        ) : (
          <div className="skeleton mt-4 h-24 rounded-xl" />
        )}
      </Card>
      <Card title="Maintenance">
        <SettingRow title="Clean up unused artwork" description={info ? `${info.unusedMedia} image file(s) not used by any game.` : undefined}>
          <button
            className="btn-ghost h-8 text-xs"
            disabled={!info?.unusedMedia}
            onClick={async () => {
              const n = await attempt(() => api.data.cleanMedia())
              if (n !== undefined) toast('success', `Removed ${n} unused file(s)`)
              load()
            }}
          >
            Clean up
          </button>
        </SettingRow>
        <SettingRow title="Reset Zenith" description="Deletes your library, playtime, collections and settings. A safety backup is saved first.">
          <button
            className="btn-danger h-8 text-xs"
            onClick={async () => {
              const ok = await ask({
                title: 'Reset everything?',
                message: 'All games, playtime history, collections and settings will be erased. Game files on disk are not touched. A backup is saved to the backups folder first.',
                confirmLabel: 'Reset Zenith',
                danger: true
              })
              if (ok) await attempt(() => api.data.resetAll(), 'Reset failed')
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </SettingRow>
      </Card>
    </>
  )
}

// ---------------- Backup & data ----------------

function DataTab() {
  const d = useStore((s) => s.settings.data)
  const { updateSettings, attempt, toast, ask } = useStore.getState()
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const load = () => void attempt(() => api.data.listBackups()).then((b) => b && setBackups(b))
  useEffect(load, [attempt])

  const restore = async (file?: string) => {
    const ok = await ask({
      title: 'Restore this backup?',
      message: 'Your current library, playtime and settings will be replaced by the backup. A snapshot of the current state is saved first.',
      confirmLabel: 'Restore',
      danger: true
    })
    if (ok) await attempt(() => api.data.restore(file), 'Restore failed')
  }

  return (
    <>
      <Card title="Import & export" description="Move your library between PCs. Imports merge with what you already have.">
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="btn-ghost"
            onClick={async () => {
              const p = await attempt(() => api.data.exportLibrary(), 'Export failed')
              if (p) toast('success', 'Library exported', p)
            }}
          >
            <Upload className="h-4 w-4" /> Export library
          </button>
          <button
            className="btn-ghost"
            onClick={async () => {
              const r = await attempt(() => api.data.importLibrary(), 'Import failed')
              if (r) toast('success', `Imported ${r.added} game(s)`, r.skipped ? `${r.skipped} skipped (duplicates or invalid)` : undefined)
            }}
          >
            <Download className="h-4 w-4" /> Import library
          </button>
        </div>
      </Card>

      <Card title="Backup & restore" description="Full snapshots: games, playtime history, collections, artwork and settings.">
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={async () => {
              const b = await attempt(() => api.data.backupNow(), 'Backup failed')
              if (b) {
                toast('success', 'Backup saved', b.name)
                load()
              }
            }}
          >
            <Archive className="h-4 w-4" /> Back up now
          </button>
          <button
            className="btn-ghost"
            onClick={async () => {
              const p = await attempt(() => api.data.backup(), 'Backup failed')
              if (p) toast('success', 'Backup saved', p)
            }}
          >
            Save backup to file…
          </button>
          <button className="btn-ghost" onClick={() => void restore()}>
            <RotateCcw className="h-4 w-4" /> Restore from file…
          </button>
        </div>
        <SettingRow title="Automatic backups">
          <Select
            className="h-9 w-36"
            value={d.autoBackup}
            onChange={(v) => void updateSettings({ data: { autoBackup: v } })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' }
            ]}
          />
        </SettingRow>
        <SettingRow title="Automatic backups to keep">
          <div className="w-48">
            <Slider value={d.keepBackups} min={1} max={20} onChange={(v) => void updateSettings({ data: { keepBackups: v } })} />
          </div>
        </SettingRow>
        <div className="mt-2">
          <div className="readout mb-2">Saved backups</div>
          {backups.length === 0 ? (
            <div className="text-sm text-muted">No backups yet.</div>
          ) : (
            <div className="space-y-1">
              {backups.map((b) => (
                <div key={b.path} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-line/[0.03]">
                  <Archive className="h-4 w-4 text-muted" />
                  <span className="flex-1 truncate font-mono text-xs">{b.name}</span>
                  <span className="num text-xs text-muted">{formatDateTime(b.createdAt)}</span>
                  <span className="num w-16 text-right text-xs text-muted">{formatBytes(b.size)}</span>
                  <button className="btn-ghost h-7 px-2.5 text-xs" onClick={() => void restore(b.path)}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </>
  )
}

// ---------------- Shortcuts ----------------

const KEYS: [string, string][] = [
  ['Ctrl + K  /  Ctrl + F', 'Search library'],
  ['Ctrl + N', 'Add a game'],
  ['Ctrl + Shift + S', 'Scan for games'],
  ['Ctrl + 1', 'Overview'],
  ['Ctrl + 2', 'Library'],
  ['Ctrl + 3', 'Statistics'],
  ['Ctrl + ,', 'Settings'],
  ['Alt + ←  /  Alt + →', 'Back / forward'],
  ['Mouse back / forward', 'Back / forward'],
  ['Double-click a game', 'Play'],
  ['Right-click a game', 'Game actions'],
  ['Esc', 'Close dialog / clear search']
]

function ShortcutsTab() {
  const hotkey = useStore((s) => s.settings.general.globalHotkey)
  const navigate = useStore((s) => s.navigate)
  return (
    <>
      <Card title="Keyboard shortcuts">
        <div className="mt-2 divide-y divide-line/[0.06]">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-fg/85">{v}</span>
              <kbd className="num rounded-md border border-line/15 bg-bg/60 px-2 py-1 text-[11px]">{k}</kbd>
            </div>
          ))}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm text-fg/85">Show / hide Zenith (global)</span>
            <button className="num rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent" onClick={() => navigate({ page: 'settings', tab: 'general' })}>
              {hotkey ? hotkey.replace(/\+/g, ' + ') : 'Not set - change'}
            </button>
          </div>
        </div>
      </Card>
      <Card title="Game shortcuts" description="Right-click any game › Create desktop shortcut or Add to Start menu. Shortcuts launch through Zenith, so playtime is still tracked.">
        <div />
      </Card>
    </>
  )
}

// ---------------- About ----------------

function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => void api.app.info().then(setInfo), [])
  return (
    <>
    <section className="panel relative overflow-hidden p-10 animate-page-in">
      <div className="starfield absolute inset-0 opacity-50" />
      <div className="absolute -right-20 -top-28 h-80 w-80 rounded-full border border-accent/20" />
      <div className="relative">
        <LogoMark size={56} />
        <div className="display mt-6 text-4xl tracking-[0.25em]">ZENITH</div>
        <div className="readout mt-2">Game launcher · Version {info?.version ?? '…'}</div>
        <p className="mt-5 max-w-lg text-sm leading-relaxed text-fg/75">
          Every game you own, at its highest point. Zenith runs fully offline: your library, artwork, playtime and settings are stored locally on this PC.
        </p>
        {info && (
          <div className="mt-8 grid max-w-xl grid-cols-2 gap-x-8 gap-y-3">
            {[
              ['Electron', info.electron],
              ['Chromium', info.chrome],
              ['Node.js', info.node],
              ['Platform', `${info.platform} ${info.arch}`],
              ['Build', info.isPackaged ? 'Release' : 'Development']
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-line/[0.06] pb-2">
                <span className="readout">{k}</span>
                <span className="num text-xs">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
    </>
  )
}

export function SettingsPage({ tab = 'general' }: { tab?: SettingsTab }) {
  const navigate = useStore((s) => s.navigate)
  const content: Record<SettingsTab, ReactNode> = {
    general: <GeneralTab />,
    appearance: <AppearanceTab />,
    library: <LibraryTab />,
    scanning: <ScanningTab />,
    startup: <StartupTab />,
    storage: <StorageTab />,
    data: <DataTab />,
    shortcuts: <ShortcutsTab />,
    updates: <UpdatesTab />,
    about: <AboutTab />
  }
  return (
    <div className="grid min-h-full grid-cols-[220px_minmax(0,1fr)] gap-8 p-8">
      <div className="sticky top-8 self-start animate-page-in">
        <div className="readout !text-accent">Configure</div>
        <h1 className="display mb-6 mt-1 text-3xl uppercase">Settings</h1>
        <nav className="flex flex-col gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate({ page: 'settings', tab: t.id })}
              className={cx(
                'flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                tab === t.id ? 'bg-line/[0.07] text-fg' : 'text-muted hover:bg-line/[0.04] hover:text-fg'
              )}
            >
              <t.icon className={cx('h-4 w-4', tab === t.id && 'text-accent')} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div key={tab} className="max-w-3xl space-y-5 pb-10">
        {content[tab]}
      </div>
    </div>
  )
}
