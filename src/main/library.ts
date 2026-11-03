// Higher-level library operations shared by IPC handlers, auto-scan and the tray.
import fs from 'node:fs'
import path from 'node:path'
import type { Game, GameInput, ImportResult, ScanCandidate, ScanProgress, ScanResult } from '@shared/types'
import { addGame, getSettings, listGames, removeGame } from './repo'
import { deleteMedia, importMediaFile, tryExtractIcon } from './media'
import { scanForGames } from './scanner'
import { prettifyTitle } from './exe'
import { log } from './log'

export async function addGameWithDefaults(input: GameInput): Promise<Game> {
  const exePath = (input.exePath ?? '').trim()
  if (!exePath && !(input.launchUri ?? '').trim()) throw new Error('Choose the game’s executable (or set a launch URI).')
  if (exePath && !fs.existsSync(exePath)) throw new Error(`Executable not found: ${exePath}`)
  const title = (input.title ?? '').trim() || (exePath ? prettifyTitle(path.basename(path.dirname(exePath))) : '')
  let icon = input.icon ?? ''
  if (!icon && exePath) icon = await tryExtractIcon(exePath)
  return addGame({
    ...input,
    title,
    exePath,
    icon,
    installDir: input.installDir || (exePath ? path.dirname(exePath) : ''),
    source: input.source ?? 'manual'
  })
}

export function removeGameAndMedia(id: string): void {
  const g = removeGame(id)
  if (g) for (const m of [g.cover, g.icon, g.hero]) if (m) deleteMedia(m)
}

export function knownForScan() {
  const games = listGames()
  return {
    exePaths: games.map((g) => g.exePath),
    installDirs: games.map((g) => g.installDir),
    sources: games.filter((g) => g.sourceId).map((g) => `${g.source}:${g.sourceId}`)
  }
}

export async function runScan(
  opts: { folders?: string[]; includeStores?: boolean },
  onProgress: (p: ScanProgress) => void
): Promise<ScanResult> {
  return scanForGames(getSettings(), knownForScan(), opts, onProgress)
}

export async function importCandidates(candidates: ScanCandidate[]): Promise<ImportResult> {
  const known = knownForScan()
  const exeSet = new Set(known.exePaths.filter(Boolean).map((p) => p.toLowerCase()))
  const srcSet = new Set(known.sources)
  let added = 0
  let skipped = 0
  for (const c of candidates) {
    if (!c?.title?.trim() || (!c.exePath && !c.launchUri)) {
      skipped++
      continue
    }
    if ((c.exePath && exeSet.has(c.exePath.toLowerCase())) || (c.sourceId && srcSet.has(`${c.source}:${c.sourceId}`))) {
      skipped++
      continue
    }
    try {
      const copy = (file: string, prefix: string) => {
        if (!file || !fs.existsSync(file)) return ''
        try {
          return importMediaFile(file, prefix)
        } catch {
          return ''
        }
      }
      await addGameWithDefaults({
        title: c.title.trim(),
        exePath: c.exePath && fs.existsSync(c.exePath) ? c.exePath : '',
        installDir: c.installDir,
        launchUri: c.launchUri,
        launchArgs: c.launchArgs ?? '',
        source: c.source,
        sourceId: c.sourceId,
        cover: copy(c.coverFile, 'cover'),
        hero: copy(c.heroFile, 'hero')
      })
      if (c.exePath) exeSet.add(c.exePath.toLowerCase())
      if (c.sourceId) srcSet.add(`${c.source}:${c.sourceId}`)
      added++
    } catch (err) {
      log.warn('Could not import scan result', c.title, (err as Error).message)
      skipped++
    }
  }
  return { added, skipped }
}
