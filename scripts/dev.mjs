// Dev runner: Vite dev server for the renderer + esbuild watch for main/preload + auto-restarting Electron.
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { watch } from './build-main.mjs'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electronBin = require('electron')

const server = await createServer({ configFile: resolve(root, 'vite.config.mts') })
await server.listen()
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/'

let child = null
let timer = null
function restart() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (child) {
      child.removeAllListeners('exit')
      child.kill()
    }
    child = spawn(electronBin, [root], {
      stdio: 'inherit',
      env: { ...process.env, VITE_DEV_SERVER_URL: url }
    })
    child.on('exit', () => {
      server.close()
      process.exit(0)
    })
  }, 150)
}

await watch(restart)
