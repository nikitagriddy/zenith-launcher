import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, Loader2, Radar, X } from 'lucide-react'
import type { ScanCandidate, ScanProgress } from '@shared/types'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { cx, formatBytes } from '../lib/format'
import { Modal } from './Modal'
import { Checkbox, Toggle } from './controls'

type Phase = 'setup' | 'scanning' | 'results'

const SOURCE_LABEL: Record<string, string> = { scan: 'Folder', steam: 'Steam', epic: 'Epic' }

export function ScanModal() {
  const open = useStore((s) => s.scanOpen)
  const settings = useStore((s) => s.settings)
  const { setScanOpen, updateSettings, attempt, toast } = useStore.getState()
  const [phase, setPhase] = useState<Phase>('setup')
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [results, setResults] = useState<ScanCandidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [warnings, setWarnings] = useState<string[]>([])
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (open) {
      setPhase('setup')
      setResults([])
      setWarnings([])
    }
  }, [open])

  useEffect(() => api.on('scan:progress', (p: ScanProgress) => setProgress(p)), [])

  const folders = settings.scanning.folders
  const addFolder = async () => {
    const p = await attempt(() => api.dialog.openFolder('Add a folder that contains games'))
    if (!p) return
    if (folders.some((f) => f.toLowerCase() === p.toLowerCase())) return toast('info', 'Folder already added')
    await updateSettings({ scanning: { folders: [...folders, p] } })
  }

  const run = async () => {
    setPhase('scanning')
    setProgress(null)
    try {
      const r = await api.scan.run({})
      setResults(r.candidates)
      setSelected(new Set(r.candidates.map((c) => c.key)))
      setWarnings(r.warnings)
      setPhase('results')
    } catch (err) {
      toast('error', 'Scan failed', (err as Error).message)
      setPhase('setup')
    }
  }

  const doImport = async () => {
    const chosen = results.filter((c) => selected.has(c.key))
    if (!chosen.length) return
    setImporting(true)
    try {
      const r = await api.scan.importCandidates(chosen)
      toast('success', `Imported ${r.added} game${r.added === 1 ? '' : 's'}`, r.skipped ? `${r.skipped} skipped (already in library or invalid).` : undefined)
      setScanOpen(false)
    } catch (err) {
      toast('error', 'Import failed', (err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const update = (key: string, patch: Partial<ScanCandidate>) => setResults((rs) => rs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  const allOn = results.length > 0 && selected.size === results.length
  const nothingToScan = !folders.length && !settings.scanning.detectSteam && !settings.scanning.detectEpic
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of results) m[c.source] = (m[c.source] ?? 0) + 1
    return m
  }, [results])

  return (
    <Modal
      open={open}
      onClose={() => phase !== 'scanning' && setScanOpen(false)}
      width="max-w-3xl"
      title="Scan for games"
      subtitle="Zenith looks for game executables in your folders and reads installed Steam and Epic Games libraries."
      footer={
        phase === 'results' ? (
          <>
            <button className="btn-ghost mr-auto" onClick={() => setPhase('setup')}>
              Back
            </button>
            <button className="btn-primary min-w-[160px]" disabled={!selected.size || importing} onClick={() => void doImport()}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Import {selected.size} game{selected.size === 1 ? '' : 's'}
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost" disabled={phase === 'scanning'} onClick={() => setScanOpen(false)}>
              Close
            </button>
            <button className="btn-primary min-w-[140px]" disabled={phase === 'scanning' || nothingToScan} onClick={() => void run()}>
              {phase === 'scanning' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
              {phase === 'scanning' ? 'Scanning…' : 'Start scan'}
            </button>
          </>
        )
      }
    >
      {phase === 'setup' && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label !mb-0">Game folders</span>
              <button className="btn-ghost h-8 px-3 text-xs" onClick={() => void addFolder()}>
                <FolderPlus className="h-3.5 w-3.5" /> Add folder
              </button>
            </div>
            {folders.length === 0 ? (
              <button
                onClick={() => void addFolder()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line/20 py-8 text-sm text-muted transition-colors hover:border-accent/60 hover:text-fg"
              >
                <FolderPlus className="h-6 w-6" />
                Add a folder like <span className="font-mono text-xs">D:\Games</span> - each sub-folder is treated as one game.
              </button>
            ) : (
              <div className="space-y-1.5">
                {folders.map((f) => (
                  <div key={f} className="flex items-center gap-3 rounded-lg border border-line/[0.08] bg-bg/40 px-3 py-2">
                    <span className="h-1.5 w-1.5 rotate-45 bg-accent" />
                    <span className="flex-1 truncate font-mono text-xs">{f}</span>
                    <button className="btn-icon h-7 w-7" onClick={() => void updateSettings({ scanning: { folders: folders.filter((x) => x !== f) } })} aria-label="Remove folder">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['detectSteam', 'Steam library', 'Reads installed Steam games and their local artwork.'],
                ['detectEpic', 'Epic Games', 'Reads installed Epic Games Launcher titles.']
              ] as const
            ).map(([key, title, text]) => (
              <div key={key} className="flex items-start justify-between gap-3 rounded-xl border border-line/[0.08] bg-bg/40 p-4">
                <div>
                  <div className="text-sm font-medium">{title}</div>
                  <div className="mt-0.5 text-xs text-muted">{text}</div>
                </div>
                <Toggle checked={settings.scanning[key]} onChange={(v) => void updateSettings({ scanning: { [key]: v } })} />
              </div>
            ))}
          </div>
          <p className="readout">Search depth: {settings.scanning.depth} levels · change in Settings › Scanning</p>
        </div>
      )}

      {phase === 'scanning' && (
        <div className="flex flex-col items-center py-14 text-center animate-fade-in">
          <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full border border-accent/40" />
            <span className="absolute inset-3 rounded-full border border-accent/30" />
            <Radar className="h-8 w-8 animate-pulse text-accent" />
          </div>
          <div className="readout !text-accent">
            {progress?.phase === 'steam' ? 'Reading Steam' : progress?.phase === 'epic' ? 'Reading Epic Games' : 'Scanning folders'}
          </div>
          <div className="mt-2 max-w-full truncate px-10 font-mono text-xs text-muted">{progress?.current || '…'}</div>
          <div className="num mt-4 text-3xl font-semibold">{progress?.found ?? 0}</div>
          <div className="readout">candidates found</div>
        </div>
      )}

      {phase === 'results' && (
        <div className="animate-fade-in">
          {results.length === 0 ? (
            <div className="py-12 text-center">
              <div className="font-display text-lg font-semibold">No new games found</div>
              <p className="mt-2 text-sm text-muted">Everything found is already in your library, or the folders contain no game executables.</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3">
                <Checkbox checked={allOn} onChange={(v) => setSelected(v ? new Set(results.map((c) => c.key)) : new Set())} />
                <span className="text-sm font-medium">{results.length} found</span>
                <span className="readout">
                  {Object.entries(counts)
                    .map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n}`)
                    .join(' · ')}
                </span>
              </div>
              <div className="space-y-2">
                {results.map((c) => {
                  const on = selected.has(c.key)
                  return (
                    <div key={c.key} className={cx('rounded-xl border p-3 transition-colors', on ? 'border-accent/40 bg-accent/[0.05]' : 'border-line/[0.08] bg-bg/30 opacity-60')}>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={on}
                          onChange={(v) => {
                            const next = new Set(selected)
                            if (v) next.add(c.key)
                            else next.delete(c.key)
                            setSelected(next)
                          }}
                        />
                        <input className="input h-8 flex-1 font-semibold" value={c.title} onChange={(e) => update(c.key, { title: e.target.value })} />
                        <span className={cx('chip shrink-0', c.source !== 'scan' && '!border-accent/40 !text-accent')}>{SOURCE_LABEL[c.source] ?? c.source}</span>
                      </div>
                      <div className="mt-2 pl-8">
                        {c.alternatives.length > 1 ? (
                          <select className="input h-8 font-mono text-[11px]" value={c.exePath} onChange={(e) => update(c.key, { exePath: e.target.value })}>
                            {c.alternatives.map((a) => (
                              <option key={a.path} value={a.path}>
                                {a.path.slice(c.installDir.length + 1) || a.path} ({formatBytes(a.size)})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="truncate font-mono text-[11px] text-muted">{c.exePath || c.launchUri}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
          {warnings.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              {warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
