import type { Game, Settings, SortKey } from '@shared/types'

export type LibFilter = 'all' | 'installed' | 'notInstalled' | 'favorites' | 'hidden' | 'recent' | 'neverPlayed'

export interface LibQuery {
  search: string
  filter: LibFilter
  categoryId?: string
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function filterGames(games: Game[], q: LibQuery, settings: Settings): Game[] {
  const term = q.search.trim().toLowerCase()
  let list = games.filter((g) => {
    if (q.filter === 'hidden') return g.hidden
    if (g.hidden && !settings.library.showHidden) return false
    if (!settings.library.showNotInstalled && !g.installed && q.filter !== 'notInstalled') return false
    switch (q.filter) {
      case 'installed':
        return g.installed
      case 'notInstalled':
        return !g.installed
      case 'favorites':
        return g.favorite
      case 'recent':
        return g.lastPlayed > 0
      case 'neverPlayed':
        return g.playtimeSec === 0
      default:
        return true
    }
  })
  if (q.categoryId) list = list.filter((g) => g.categoryIds.includes(q.categoryId!))
  if (term) {
    list = list.filter(
      (g) =>
        g.title.toLowerCase().includes(term) ||
        g.developer.toLowerCase().includes(term) ||
        g.exePath.toLowerCase().includes(term)
    )
  }
  return sortGames(list, q.sortBy, q.sortDir)
}

export function sortGames(list: Game[], by: SortKey, dir: 'asc' | 'desc'): Game[] {
  const m = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    let r = 0
    if (by === 'name') r = collator.compare(a.title, b.title)
    else if (by === 'playtime') r = a.playtimeSec - b.playtimeSec
    else if (by === 'lastPlayed') r = a.lastPlayed - b.lastPlayed
    else if (by === 'added') r = a.addedAt - b.addedAt
    if (r === 0) r = collator.compare(a.title, b.title) * (by === 'name' ? 1 : m)
    return r * m
  })
}

export function visibleGames(games: Game[], settings: Settings): Game[] {
  return games.filter((g) => !g.hidden || settings.library.showHidden)
}
