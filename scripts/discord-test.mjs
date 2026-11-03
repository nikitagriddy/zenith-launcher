// Live Discord Rich Presence check. Needs Discord running on this PC; briefly shows a status on YOUR profile.
// Usage: npm run build && node scripts/discord-test.mjs
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const dir = resolve('.e2e-discord')
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'game'), { recursive: true })
const exe = join(dir, 'game', 'DeadByDaylight.exe')
copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE'), exe)

const app = await _electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, ZENITH_USER_DATA: join(dir, 'user') } })
const p = await app.firstWindow()
await p.waitForFunction(() => !!window.zenith)
const st = () => p.evaluate(() => window.zenith.discord.status())
const wait = async (pred, ms) => {
  const end = Date.now() + ms
  let s
  while (Date.now() < end) {
    s = await st()
    if (pred(s)) return s
    await new Promise((r) => setTimeout(r, 300))
  }
  return s
}
let bad = 0
const check = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) bad++
}

await p.evaluate(() => window.zenith.settings.set({ general: { minimizeOnLaunch: false }, library: { autoArtwork: false } }))
const s0 = await p.evaluate(() => window.zenith.settings.get())
check(s0.discord.statusShows === 'launcher', 'default status line shows Zenith, not the game')
const s1 = await wait((s) => s.state === 'connected' || s.state === 'error', 15000)
check(s1.state === 'connected', `connected to Discord (${s1.state}${s1.user ? ' as ' + s1.user : ''}${s1.message ? ' - ' + s1.message : ''})`)

const g = await p.evaluate((e) => window.zenith.games.add({ title: 'Dead by Daylight', exePath: e, launchArgs: '-n 20 127.0.0.1' }), exe)
await p.evaluate((id) => window.zenith.games.launch(id), g.id)
const s2 = await wait((s) => s.state === 'playing' || s.state === 'error', 15000)
check(s2.state === 'playing' && s2.game === 'Dead by Daylight', `presence set, "Playing Zenith" mode (${s2.state} ${s2.message ?? ''})`)
await new Promise((r) => setTimeout(r, 4000))
await p.evaluate(() => window.zenith.settings.set({ discord: { statusShows: 'game' } }))
await new Promise((r) => setTimeout(r, 4000))
const s3 = await st()
check(s3.state === 'playing', `switching to "Playing <game>" mode accepted by Discord (${s3.state} ${s3.message ?? ''})`)
await p.evaluate(() => window.zenith.settings.set({ discord: { statusShows: 'launcher' } }))

const s4 = await wait((s) => s.state === 'connected', 40000)
check(s4.state === 'connected', 'presence cleared after the game closed')
await p.evaluate(() => window.zenith.settings.set({ discord: { enabled: false } }))
check((await wait((s) => s.state === 'off', 5000)).state === 'off', 'turning it off disconnects')
await app.close()
rmSync(dir, { recursive: true, force: true })
console.log(bad ? `${bad} failed` : 'All Discord checks passed')
process.exit(bad ? 1 : 0)
