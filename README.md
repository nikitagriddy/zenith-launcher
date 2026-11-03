# Zenith

A fast, beautiful game launcher for Windows. Zenith gathers your games from folders, Steam, and Epic into one library, with playtime tracking, collections, statistics, and backups. It runs fully offline.

The interface, called **Observatory**, uses an ink-black sky, solar-orange accents, a star field, and film grain.

## Features

**Dashboard**
- Featured carousel, continue playing, recently played and added, favorites, stats tiles, quick access

**Library**
- Grid, compact, and list layouts with a size slider
- Search and filters: installed, favorites, played, unplayed, missing, hidden
- Sort by name, playtime, recently played, or date added
- Collections: custom categories with colors

**Adding games**
- Folder scanning with smart `.exe` detection (skips uninstallers, redistributables, and crash handlers)
- Steam and Epic Games library detection, with Steam local artwork
- Manual add, or drag and drop an `.exe` onto the window

**Game details**
- Play button, playtime, last played, install location, launch arguments
- Run as administrator (UAC), edit, remove
- Desktop and Start menu shortcuts per game that launch through Zenith (playtime is still tracked)

**Playtime and statistics**
- Automatic playtime tracking, including launcher stubs (via process polling)
- Statistics page: 30-day chart, weekday breakdown, top games, launch history

**Personalization**
- Themes: Ink, Void, Dusk, Paper
- Accent colors (presets or custom)
- Backgrounds, including a custom image with blur and dim
- Toggles for animations, glass, and grain; UI scale; sidebar styles

**Settings**
- General, Appearance, Library, Scanning (on startup, on interval, auto-import), Startup (launch at login, start minimized), Storage, Backup and Data, Shortcuts, About

**Backup and data**
- Library export and import as JSON
- Full backup and restore as `.zbak`
- Automatic daily and weekly backups

**Keyboard and system**
- Global hotkey: `Ctrl+Alt+Z` (default)
- In-app: `Ctrl+K` search, `Ctrl+N` add game, `Ctrl+Shift+S` scan, `Ctrl+1/2/3` switch pages, `Ctrl+,` settings, `Alt+Left/Right` back and forward
- Tray icon with recent games

## Install

Run `release\Zenith-Setup-1.0.0.exe` (produced by `npm run dist`).

- Per-user install; you choose the folder
- Creates desktop and Start menu shortcuts
- The installer is unsigned, so Windows SmartScreen may warn. Click **More info**, then **Run anyway**.

## Development

### Stack

| Layer     | Technology                                        |
| --------- | ------------------------------------------------- |
| Shell     | Electron 37                                       |
| UI        | React 18, TypeScript, Tailwind CSS 3              |
| Data      | SQLite via sql.js (WASM, no native build)         |
| Build     | Vite (renderer), esbuild (main and preload)       |
| Packaging | electron-builder (NSIS installer)                 |

Fonts (Unbounded, Instrument Sans, JetBrains Mono) are bundled, so the app works offline.

### Requirements

Windows, with Node.js and npm.

### Commands

| Command              | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `npm install`        | Install dependencies                                                                        |
| `npm run dev`        | Vite dev server with auto-restarting Electron                                               |
| `npm run build`      | Typecheck, then build main and renderer                                                     |
| `npm run typecheck`  | Type-check only                                                                             |
| `npm start`          | Run the built app                                                                           |
| `npm run test:e2e`   | Playwright drives the real app: scan, launch, playtime, backup/restore, persistence. Screenshots go to `.e2e-data/shots` |
| `npm run dist`       | Build the installer into `release/`                                                         |
| `npm run dist:dir`   | Build an unpacked app into `release/` (no installer)                                        |
| `npm run icon`       | Regenerate the icon PNG                                                                     |

### Project layout

```
src/
  main/       db, repo, scanner, exe heuristics, launcher, backup, ipc, media
  preload/    preload script
  renderer/   pages, components, lib (React UI)
  shared/     types and settings shared by main and renderer
scripts/      dev, build, icon, and e2e scripts
```

## Data

User data lives in `%APPDATA%\Zenith`:

```
zenith.db        library database
media\           cached artwork
backups\         full and automatic backups (.zbak)
logs\main.log    main-process log
```

To use a different location, set the `ZENITH_USER_DATA` environment variable.

## Notes and limits

- **Steam and Epic games** launch through their clients (`steam://` and `com.epicgames.launcher://` URLs). Their playtime is tracked by watching the game's executable processes.
- **SmartScreen:** the installer is unsigned. See [Install](#install).
- **Build fails with `Cannot create symbolic link` (winCodeSign):** enable Windows Developer Mode, or run the terminal as administrator once, then run `npm run dist` again.
