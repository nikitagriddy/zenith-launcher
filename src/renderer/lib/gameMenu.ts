import { Eye, EyeOff, FolderOpen, ImageDown, Info, Link, Pencil, Play, Star, Trash2, MonitorSmartphone } from 'lucide-react'
import type { Game } from '@shared/types'
import { Zap } from 'lucide-react'
import { api } from './api'
import { PotatoIcon } from './modes'
import { useStore, type MenuItem } from './store'

/** Context-menu actions for a game, shared by cards, rows and the details page. */
export function gameMenuItems(game: Game): MenuItem[] {
  const s = useStore.getState()
  const running = !!s.running[game.id]
  return [
    { label: running ? 'Running…' : 'Play', icon: Play, disabled: running || !game.installed, onClick: () => void s.launch(game.id) },
    { label: 'Play in Potato mode', icon: PotatoIcon, disabled: running || !game.installed, onClick: () => void s.launch(game.id, 'potato') },
    { label: 'Play with Boost', icon: Zap, disabled: running || !game.installed, onClick: () => void s.launch(game.id, 'boost') },
    { label: 'View details', icon: Info, onClick: () => s.navigate({ page: 'game', id: game.id }) },
    { separator: true, label: '' },
    { label: game.favorite ? 'Remove from favorites' : 'Add to favorites', icon: Star, onClick: () => void s.toggleFavorite(game.id) },
    { label: 'Edit game…', icon: Pencil, onClick: () => s.openEditor(game.id) },
    {
      label: game.hidden ? 'Unhide' : 'Hide from library',
      icon: game.hidden ? Eye : EyeOff,
      onClick: () =>
        void s.attempt(async () => {
          await api.games.update(game.id, { hidden: !game.hidden })
          s.toast('success', game.hidden ? 'Game is visible again' : 'Game hidden', game.hidden ? undefined : 'Find it under the Hidden filter in your library.')
        })
    },
    {
      label: 'Find artwork online',
      icon: ImageDown,
      onClick: () =>
        void s.attempt(async () => {
          const changed = await api.art.fetch(game.id)
          s.toast(changed ? 'success' : 'info', changed ? 'Artwork updated' : 'No new artwork found', changed ? game.title : 'Remove the current cover/banner in Edit to replace it, or pick your own image.')
        }, 'Artwork lookup failed')
    },
    { separator: true, label: '' },
    {
      label: 'Open install folder',
      icon: FolderOpen,
      disabled: !game.installDir && !game.exePath,
      onClick: () => void s.attempt(() => api.games.openFolder(game.id), 'Could not open folder')
    },
    {
      label: 'Create desktop shortcut',
      icon: Link,
      onClick: () =>
        void s.attempt(async () => {
          const p = await api.games.createShortcut(game.id, 'desktop')
          s.toast('success', 'Shortcut created', p)
        }, 'Could not create shortcut')
    },
    {
      label: 'Add to Start menu',
      icon: MonitorSmartphone,
      onClick: () =>
        void s.attempt(async () => {
          const p = await api.games.createShortcut(game.id, 'startMenu')
          s.toast('success', 'Added to Start menu', p)
        }, 'Could not create shortcut')
    },
    { separator: true, label: '' },
    { label: 'Remove from library', icon: Trash2, danger: true, disabled: running, onClick: () => void s.removeGame(game.id) }
  ]
}

export function openGameMenu(e: React.MouseEvent, game: Game): void {
  e.preventDefault()
  e.stopPropagation()
  useStore.getState().openMenu(e.clientX, e.clientY, gameMenuItems(game))
}
