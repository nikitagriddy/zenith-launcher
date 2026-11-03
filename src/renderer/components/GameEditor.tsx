import { useEffect, useState, type ReactNode } from 'react'
import { FileSearch, FolderOpen, ImagePlus, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import type { GameInput } from '@shared/types'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { cx, mediaUrl } from '../lib/format'
import { Modal } from './Modal'
import { Toggle } from './controls'
import { GameCover, GameIcon } from './GameArt'

type Form = Required<
  Pick<
    GameInput,
    'title' | 'exePath' | 'workingDir' | 'launchArgs' | 'launchUri' | 'runAsAdmin' | 'description' | 'developer' | 'cover' | 'icon' | 'hero' | 'favorite' | 'hidden' | 'categoryIds' | 'installDir'
  >
>

const EMPTY: Form = {
  title: '',
  exePath: '',
  workingDir: '',
  launchArgs: '',
  launchUri: '',
  runAsAdmin: false,
  description: '',
  developer: '',
  cover: '',
  icon: '',
  hero: '',
  favorite: false,
  hidden: false,
  categoryIds: [],
  installDir: ''
}

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico'] }]

function titleFromPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  const file = (parts.pop() ?? '').replace(/\.[^.]+$/, '')
  const parent = parts.pop() ?? ''
  const raw = parent && !/^(bin|binaries|win64|x64|x86|game)$/i.test(parent) ? parent : file
  return raw
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] text-muted/80">{hint}</span>}
    </label>
  )
}

export function GameEditor() {
  const editor = useStore((s) => s.editor)
  const games = useStore((s) => s.games)
  const categories = useStore((s) => s.categories)
  const { closeEditor, toast, attempt, navigate, refreshCategories } = useStore.getState()
  const existing = editor.gameId ? games.find((g) => g.id === editor.gameId) : undefined
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (!editor.open) return
    if (existing) {
      const { title, exePath, workingDir, launchArgs, launchUri, runAsAdmin, description, developer, cover, icon, hero, favorite, hidden, categoryIds, installDir } = existing
      setForm({ title, exePath, workingDir, launchArgs, launchUri, runAsAdmin, description, developer, cover, icon, hero, favorite, hidden, categoryIds, installDir })
      setShowAdvanced(!!(workingDir || launchUri))
    } else {
      const preset = { ...EMPTY, ...(editor.preset as Partial<Form>) }
      if (preset.exePath && !preset.title) preset.title = titleFromPath(preset.exePath)
      setForm(preset)
      setShowAdvanced(false)
    }
    setNewCat('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.open, editor.gameId])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const browseExe = async () => {
    const p = await attempt(() =>
      api.dialog.openFile({
        title: 'Select game executable',
        filters: [
          { name: 'Games & shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    )
    if (!p) return
    const dir = p.replace(/[\\/][^\\/]+$/, '')
    setForm((f) => ({
      ...f,
      exePath: p,
      title: f.title || titleFromPath(p),
      // Keep a store install folder if the new exe lives inside it; otherwise follow the exe.
      installDir: f.installDir && p.toLowerCase().startsWith(f.installDir.toLowerCase()) ? f.installDir : dir
    }))
  }

  const browseDir = async () => {
    const p = await attempt(() => api.dialog.openFolder('Select working directory'))
    if (p) set('workingDir', p)
  }

  const pickImage = async (key: 'cover' | 'icon' | 'hero') => {
    const p = await attempt(() => api.dialog.openFile({ title: `Choose ${key} image`, filters: IMAGE_FILTERS }))
    if (!p) return
    const name = await attempt(() => api.media.importFile(p, key), 'Could not use image')
    if (name) set(key, name)
  }

  const iconFromExe = async () => {
    if (!form.exePath) return toast('error', 'Choose an executable first')
    const name = await attempt(() => api.games.extractIcon(form.exePath), 'Could not extract icon')
    if (name) set('icon', name)
  }

  const addCategory = async () => {
    const n = newCat.trim()
    if (!n) return
    const c = await attempt(() => api.categories.create(n), 'Could not create collection')
    if (!c) return
    await refreshCategories()
    set('categoryIds', [...form.categoryIds, c.id])
    setNewCat('')
  }

  const save = async () => {
    if (!form.title.trim()) return toast('error', 'Title is required')
    if (!form.exePath.trim() && !form.launchUri.trim()) return toast('error', 'Executable required', 'Choose the game’s .exe file (or set a launch URI under Advanced).')
    setSaving(true)
    try {
      if (existing) {
        await api.games.update(existing.id, form)
        toast('success', 'Changes saved', form.title)
      } else {
        const g = await api.games.add(form)
        toast('success', 'Game added', g.title)
        navigate({ page: 'game', id: g.id })
      }
      closeEditor()
    } catch (err) {
      toast('error', 'Could not save game', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const preview = { title: form.title || 'Untitled', icon: form.icon, cover: form.cover, hero: form.hero }

  return (
    <Modal
      open={editor.open}
      onClose={closeEditor}
      width="max-w-4xl"
      title={existing ? 'Edit game' : 'Add a game'}
      subtitle={existing ? existing.title : 'Point Zenith at any game executable, shortcut or launcher.'}
      footer={
        <>
          <button className="btn-ghost" onClick={closeEditor}>
            Cancel
          </button>
          <button className="btn-primary min-w-[120px]" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Add to library'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-7">
        {/* Artwork column */}
        <div className="space-y-5">
          <div>
            <span className="label">Cover · 2:3</span>
            <div className="group relative">
              <GameCover game={preview} className="ticks aspect-[2/3] w-full rounded-xl ring-1 ring-line/10" />
              <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <button className="btn-primary h-8 px-3 text-xs" onClick={() => void pickImage('cover')}>
                  <ImagePlus className="h-3.5 w-3.5" /> Change
                </button>
                {form.cover && (
                  <button className="btn-icon bg-black/50 text-white" onClick={() => set('cover', '')} aria-label="Remove cover">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div>
            <span className="label">Icon</span>
            <div className="flex items-center gap-3">
              <GameIcon game={preview} size={52} />
              <div className="flex flex-col gap-1.5">
                <button className="btn-ghost h-7 px-2.5 text-xs" onClick={() => void pickImage('icon')}>
                  <ImagePlus className="h-3.5 w-3.5" /> Choose
                </button>
                <button className="btn-ghost h-7 px-2.5 text-xs" onClick={() => void iconFromExe()}>
                  <Sparkles className="h-3.5 w-3.5" /> From .exe
                </button>
              </div>
              {form.icon && (
                <button className="btn-icon h-7 w-7" onClick={() => set('icon', '')} aria-label="Remove icon">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div>
            <span className="label">Banner · 16:9</span>
            <button
              onClick={() => void pickImage('hero')}
              className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-line/20 bg-bg/50 text-xs text-muted transition-colors hover:border-accent/60 hover:text-fg"
            >
              {form.hero ? <img src={mediaUrl(form.hero)} className="absolute inset-0 h-full w-full object-cover" alt="" /> : <span className="flex items-center gap-1.5"><ImagePlus className="h-4 w-4" /> Add banner</span>}
            </button>
            {form.hero && (
              <button className="mt-1.5 text-[11px] text-muted hover:text-red-400" onClick={() => set('hero', '')}>
                Remove banner
              </button>
            )}
          </div>
        </div>

        {/* Details column */}
        <div className="space-y-4">
          <Field label="Title">
            <input autoFocus className="input h-11 text-base font-semibold" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Game title" />
          </Field>
          <Field label="Executable" hint="The .exe that starts the game. Shortcuts (.lnk / .url) and .bat files also work.">
            <div className="flex gap-2">
              <input className="input font-mono text-xs" value={form.exePath} onChange={(e) => set('exePath', e.target.value)} placeholder="C:\Games\MyGame\MyGame.exe" />
              <button className="btn-ghost shrink-0" onClick={() => void browseExe()}>
                <FileSearch className="h-4 w-4" /> Browse
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Launch arguments">
              <input className="input font-mono text-xs" value={form.launchArgs} onChange={(e) => set('launchArgs', e.target.value)} placeholder="-windowed -novid" />
            </Field>
            <Field label="Developer">
              <input className="input" value={form.developer} onChange={(e) => set('developer', e.target.value)} placeholder="Studio name" />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line/[0.08] bg-bg/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-accent" />
              <div>
                <div className="text-sm font-medium">Run as administrator</div>
                <div className="text-xs text-muted">Windows will ask for permission (UAC) each launch.</div>
              </div>
            </div>
            <Toggle checked={form.runAsAdmin} onChange={(v) => set('runAsAdmin', v)} />
          </div>
          <Field label="Description">
            <textarea className="input h-24 resize-none py-2.5 leading-relaxed" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What is this game about?" />
          </Field>

          <div>
            <span className="label">Collections</span>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => {
                const on = form.categoryIds.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => set('categoryIds', on ? form.categoryIds.filter((x) => x !== c.id) : [...form.categoryIds, c.id])}
                    className={cx('chip h-7 transition-colors', on ? 'border-accent/60 bg-accent/15 text-fg' : 'text-muted hover:text-fg')}
                  >
                    <span className="h-1.5 w-1.5 rotate-45 rounded-[1px]" style={{ background: c.color }} /> {c.name}
                  </button>
                )
              })}
              <div className="flex items-center gap-1">
                <input
                  className="input h-7 w-36 px-2 text-xs"
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addCategory()}
                  placeholder="New collection"
                />
                <button className="btn-icon h-7 w-7" onClick={() => void addCategory()} aria-label="Create collection">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2.5 text-sm">
              <Toggle checked={form.favorite} onChange={(v) => set('favorite', v)} /> Favorite
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <Toggle checked={form.hidden} onChange={(v) => set('hidden', v)} /> Hidden
            </label>
          </div>

          <div>
            <button className="readout hover:text-fg" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? '− Advanced' : '+ Advanced'}
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-4 animate-fade-in">
                <Field label="Working directory" hint="Defaults to the executable's folder.">
                  <div className="flex gap-2">
                    <input className="input font-mono text-xs" value={form.workingDir} onChange={(e) => set('workingDir', e.target.value)} placeholder="(executable folder)" />
                    <button className="btn-ghost shrink-0" onClick={() => void browseDir()}>
                      <FolderOpen className="h-4 w-4" />
                    </button>
                  </div>
                </Field>
                <Field label="Launch URI" hint="Optional. e.g. steam://rungameid/570. Used instead of the executable for store-managed games.">
                  <input className="input font-mono text-xs" value={form.launchUri} onChange={(e) => set('launchUri', e.target.value)} placeholder="steam://rungameid/…" />
                </Field>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
