// Regenerates the app icons from build/logo.svg by rendering it in Electron (Chromium), so the
// icon is pixel-identical to the SVG. Usage: npm run icon
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const electron = createRequire(import.meta.url)('electron')
const r = spawnSync(electron, [resolve(root, 'scripts', 'render-icon.cjs')], { stdio: 'inherit' })
process.exit(r.status ?? 1)
