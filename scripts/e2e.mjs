// End-to-end smoke test: boots the built app with an isolated data folder, scans a fake games folder,
// launches a real executable, and checks playtime tracking, favorites, collections, settings and backups.
// Usage: npm run build && npm run test:e2e   (screenshots go to .e2e-data/shots)
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const require = createRequire(import.meta.url)
const data = join(root, '.e2e-data')
const userData = join(data, 'user')
const games = join(data, 'Games')
const shots = join(data, 'shots')

rmSync(data, { recursive: true, force: true })
for (const d of [userData, shots, join(games, 'Ping Quest'), join(games, 'Star_Drifter', '_CommonRedist'), join(games, 'NeonRunner', 'bin', 'x64')]) {
  mkdirSync(d, { recursive: true })
}
// Real executable that runs ~3 seconds and exits (ping with -n 4).
const ping = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE')
copyFileSync(ping, join(games, 'Ping Quest', 'PingQuest.exe'))
copyFileSync(ping, join(games, 'Star_Drifter', 'StarDrifter.exe'))
writeFileSync(join(games, 'Star_Drifter', 'unins000.exe'), 'x') // must be ignored
writeFileSync(join(games, 'Star_Drifter', '_CommonRedist', 'vcredist_x64.exe'), 'x') // must be ignored
copyFileSync(ping, join(games, 'NeonRunner', 'bin', 'x64', 'NeonRunner.exe'))

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!cond) failures++
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: [root],
  env: { ...process.env, ZENITH_USER_DATA: userData }
})
const page = await app.firstWindow()
page.on('pageerror', (e) => {
  console.log('PAGE ERROR', e.message)
  failures++
})
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
const api = (fn, arg) => page.evaluate(fn, arg)
async function until(fn, arg, timeout = 15000, p = page) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await p.evaluate(fn, arg).catch(() => false)) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Timed out waiting for condition')
}
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) })

await page.getByText('is empty.').waitFor({ timeout: 20000 })
check(true, 'app boots to onboarding screen')
await shot('01-onboarding')

// Test-only: avoid window minimizing during launch, disable store detection.
await api(
  (f) => window.zenith.settings.set({ general: { minimizeOnLaunch: false }, library: { autoArtwork: false }, scanning: { folders: [f], detectSteam: false, detectEpic: false, detectGog: false, detectEa: false, detectUbisoft: false, detectBattlenet: false, detectRiot: false } }),
  games
)

// Scan through the UI.
await page.getByRole('button', { name: 'Scan for games' }).first().click()
await page.getByRole('button', { name: 'Start scan' }).click()
await page.getByText('3 found').waitFor({ timeout: 20000 })
check(true, 'scan finds 3 games (uninstaller + redist ignored)')
await shot('02-scan-results')
await page.getByRole('button', { name: /Import 3 games/ }).click()
await until(async () => (await window.zenith.games.list()).length === 3)
const list = await api(() => window.zenith.games.list())
check(list.length === 3, 'three games imported')
check(list.every((g) => g.installed), 'all imported games are marked installed')
check(list.some((g) => g.title === 'Neon Runner' && g.exePath.endsWith('NeonRunner.exe')), 'nested bin/x64 exe detected with prettified title')
check(list.every((g) => !!g.icon), 'icons extracted from executables')

// Launch a game and verify playtime tracking.
const pq = list.find((g) => g.title === 'Ping Quest')
await api((id) => window.zenith.games.update(id, { launchArgs: '-n 5 127.0.0.1', description: 'A test game that pings localhost.' }), pq.id)
await page.getByRole('button', { name: 'Library' }).first().click()
await page.getByText('Ping Quest').first().click()
await page.getByRole('button', { name: 'PLAY' }).click()
await page.getByText('In session').first().waitFor({ timeout: 10000 })
check(true, 'game launches and shows running state')
await shot('03-running')
await until(async (id) => (await window.zenith.games.running()).every((r) => r.gameId !== id), pq.id, 30000)
const after = await api((id) => window.zenith.games.list().then((l) => l.find((g) => g.id === id)), pq.id)
check(after.playtimeSec >= 2, `playtime tracked after exit (${after.playtimeSec}s)`)
check(after.launchCount === 1, 'launch count incremented')
const sessions = await api((id) => window.zenith.games.sessions(id), pq.id)
check(sessions.length === 1, 'session recorded in launch history')

// Missing executable shows a clean error instead of crashing.
const bad = await api(() =>
  window.zenith.games.add({ title: 'Ghost Game', exePath: '' , launchUri: '' }).then(
    () => 'added',
    (e) => e.message
  )
)
check(bad !== 'added', `game without executable rejected: ${bad}`)

// Real artwork from the Steam store (needs internet).
const dbd = await api((exe) => window.zenith.games.add({ title: 'Dead by Daylight', exePath: exe }), pq.exePath)
const gotArt = await api((id) => window.zenith.art.fetch(id), dbd.id)
const dbdAfter = await api((id) => window.zenith.games.list().then((l) => l.find((g) => g.id === id)), dbd.id)
check(gotArt && !!dbdAfter.cover && !!dbdAfter.hero && !!dbdAfter.description, `real cover, banner and description downloaded (${dbdAfter.developer || 'no dev'})`)

// ---- Game page extras (Steam trailer, screenshots, news) ----
const ex = await api((id) => window.zenith.extras.get(id), dbd.id)
check(!!ex.trailer && ex.screenshots.length >= 3 && ex.news.length > 0, `extras: trailer + ${ex.screenshots.length} screenshots + ${ex.news.length} news`)
await page.getByRole('button', { name: 'Library' }).first().click()
await page.getByText('Dead by Daylight').first().click()
await page.getByRole('button', { name: 'Play trailer' }).waitFor({ timeout: 15000 })
await page.getByRole('button', { name: 'Play trailer' }).click()
const played = await (async () => {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    const t = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0)
    if (t > 1) return t
    await page.waitForTimeout(500)
  }
  return 0
})()
check(played > 1, `Steam trailer streams in the app (played ${played.toFixed(1)}s)`)
await page.evaluate(() => document.querySelector('video')?.pause())
await page.mouse.wheel(0, 500)
await page.waitForTimeout(600)
await shot('11-game-extras')
const size = await api((id) => window.zenith.extras.size(id, true), pq.id)
check(!!size && size.bytes > 1000 && size.files >= 1, `install size measured (${size?.bytes} bytes)`)
const sd = (await api(() => window.zenith.games.list())).find((g) => g.title.startsWith('Star'))
const un = await api((id) => window.zenith.extras.uninstallInfo(id), sd.id)
check(un.available && /uninstaller/i.test(un.label), `uninstaller found in game folder (${un.label})`)
const un2 = await api((id) => window.zenith.extras.uninstallInfo(id), pq.id)
check(!un2.available, 'no fake uninstaller offered when none exists')
const un3 = await api((id) => window.zenith.extras.uninstallInfo(id), dbd.id)
check(!un3.available, `same-name game elsewhere on disk is never uninstalled by mistake (${un3.label})`)

// ---- Discount Games (100% off) ----
const deals = await api(() => window.zenith.deals.list(true))
check(deals.deals.length > 0 && deals.deals.every((d) => d.url.startsWith('https://')), `free games loaded: ${deals.deals.length} (${[...new Set(deals.deals.map((d) => d.store))].join(', ')})`)
await page.getByRole('button', { name: 'Discount Games' }).click()
await page.getByRole('heading', { name: 'Free right now' }).waitFor({ timeout: 15000 })
await page.waitForTimeout(1500)
await shot('12-discount-games')

// ---- Other stores: temporary fake registry entries (removed in finally) ----
const UN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'
const stores = join(data, 'Stores')
const riotDir = join(stores, 'ZenithRiotGame'), riotClient = join(stores, 'RiotClient', 'RiotClientServices.exe')
const eaDir = join(stores, 'ZenithEAGame'), bnDir = join(stores, 'ZenithBlizzGame')
for (const d of [riotDir, join(stores, 'RiotClient'), eaDir, join(bnDir, '_retail_')]) mkdirSync(d, { recursive: true })
copyFileSync(ping, riotClient)
copyFileSync(ping, join(riotDir, 'ZenithRiotGame.exe'))
copyFileSync(ping, join(eaDir, 'ZenithEAGame.exe'))
copyFileSync(ping, join(bnDir, 'Zenith Blizz Game Launcher.exe'))
copyFileSync(ping, join(bnDir, '_retail_', 'ZenithBlizz.exe'))
const reg = (key, vals) => { for (const [n, v] of Object.entries(vals)) execFileSync('reg', ['add', UN + key, '/v', n, '/t', 'REG_SZ', '/d', v, '/f'], { stdio: 'ignore' }) }
const keys = ['Riot Game zenithtest.live', 'ZenithTestEA', 'ZenithTestBnet']
try {
  reg(keys[0], { DisplayName: 'Zenith Riot Game', Publisher: 'Riot Games, Inc', InstallLocation: riotDir, UninstallString: `"${riotClient}" --uninstall-product=zenithtest --uninstall-patchline=live` })
  reg(keys[1], { DisplayName: 'Zenith EA Game', Publisher: 'Electronic Arts', InstallLocation: eaDir, UninstallString: `"${join(eaDir, 'ZenithEAGame.exe')}"` })
  reg(keys[2], { DisplayName: 'Zenith Blizz Game', Publisher: 'Blizzard Entertainment', InstallLocation: bnDir, UninstallString: '"C:\\ProgramData\\Battle.net\\Agent\\Blizzard Uninstaller.exe" --lang=enUS --uid=zenithtest --displayname="Zenith Blizz Game"' })
  await api(() => window.zenith.settings.set({ scanning: { detectEa: true, detectBattlenet: true, detectRiot: true } }))
  const sr = await api(() => window.zenith.scan.run({ folders: [] }))
  const riotC = sr.candidates.find((c) => c.source === 'riot')
  const eaC = sr.candidates.find((c) => c.source === 'ea' && c.title === 'Zenith EA Game')
  const bnC = sr.candidates.find((c) => c.source === 'battlenet')
  check(!!riotC && riotC.exePath.endsWith('RiotClientServices.exe') && /--launch-product=zenithtest/.test(riotC.launchArgs), 'Riot game detected, launches through Riot Client')
  check(!!eaC && eaC.exePath.endsWith('ZenithEAGame.exe'), 'EA app game detected')
  check(!!bnC && /Launcher.exe$/.test(bnC.exePath), 'Battle.net game detected, launches through its launcher')
  check(!sr.candidates.some((c) => /riot client/i.test(c.title)), 'Riot Client itself is not listed as a game')
  await api((c) => window.zenith.scan.importCandidates(c), [riotC])
  const rg = (await api(() => window.zenith.games.list())).find((g) => g.source === 'riot')
  // Launch: Zenith starts the (fake) Riot Client, then the "game" starts a moment later like the real thing.
  await api((id) => window.zenith.games.launch(id), rg.id)
  await page.waitForTimeout(3000)
  spawn(join(riotDir, 'ZenithRiotGame.exe'), ['-n', '6', '127.0.0.1'], { stdio: 'ignore', detached: true }).unref()
  await until(async (id) => (await window.zenith.games.running()).some((r) => r.gameId === id && r.tracking === 'process'), rg.id, 20000)
  await until(async (id) => (await window.zenith.games.running()).every((r) => r.gameId !== id), rg.id, 40000)
  const rgAfter = (await api(() => window.zenith.games.list())).find((g) => g.id === rg.id)
  check(rgAfter.playtimeSec >= 3 && rgAfter.playtimeSec < 15, `store-client game tracked by its own process (${rgAfter.playtimeSec}s, client not counted)`)
  await api((id) => window.zenith.games.remove(id), rg.id)
} finally {
  for (const k of keys) { try { execFileSync('reg', ['delete', UN + k, '/f'], { stdio: 'ignore' }) } catch {} }
  await api(() => window.zenith.settings.set({ scanning: { detectEa: false, detectBattlenet: false, detectRiot: false } }))
}
await api((id) => window.zenith.games.remove(id), dbd.id)
// Newer Steam games keep their tall cover under hashed paths.
const pbz = await api((exe) => window.zenith.games.add({ title: 'Phantom Blade Zero', exePath: exe }), pq.exePath)
await api((id) => window.zenith.art.fetch(id), pbz.id)
const pbzArt = await api((id) => window.zenith.games.list().then((l) => l.find((g) => g.id === id)), pbz.id)
const ratio = await page.evaluate(async (name) => {
  const img = new Image()
  img.src = `zenith-media://media/${encodeURIComponent(name)}`
  await img.decode()
  return img.naturalHeight / img.naturalWidth
}, pbzArt.cover || 'missing.png').catch(() => 0)
check(!!pbzArt.cover && ratio > 1.3, `tall cover found for a new Steam game (h/w ${ratio.toFixed(2)})`)
await api((id) => window.zenith.games.remove(id), pbz.id)

// Favorites, collections, settings.
await api((id) => window.zenith.games.toggleFavorite(id), pq.id)
const cat = await api(() => window.zenith.categories.create('Roguelikes', '#3ee08f'))
await api(([g, c]) => window.zenith.games.setCategories(g, [c]), [pq.id, cat.id])
const fav = await api((id) => window.zenith.games.list().then((l) => l.find((g) => g.id === id)), pq.id)
check(fav.favorite && fav.categoryIds.includes(cat.id), 'favorite + collection saved')

await page.getByRole('button', { name: 'Overview' }).click()
await page.getByText('Continue playing').waitFor()
await page.waitForTimeout(800)
await shot('04-home')
await page.getByRole('button', { name: 'Statistics' }).first().click()
await page.getByText('Last 30 days').waitFor()
await page.waitForTimeout(600)
await shot('05-stats')
await page.getByRole('button', { name: 'Library' }).first().click()
await page.waitForTimeout(600)
await shot('06-library')
await page.getByText('Ping Quest').first().click()
await page.waitForTimeout(600)
await shot('07-details')

await page.getByRole('button', { name: 'Settings' }).first().click()
await page.getByRole('button', { name: 'Appearance' }).click()
await page.getByTitle('Ice').click()
await page.waitForTimeout(300)
const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
check(accent === '56 200 245', `accent color applies live (${accent})`)
await shot('08-settings-appearance')
await api(() => window.zenith.settings.set({ appearance: { uiScale: 105 } }))
await page.waitForTimeout(400)
const knobOk = await page.evaluate(() =>
  [...document.querySelectorAll('button[role=switch]')].every((b) => {
    const t = b.getBoundingClientRect()
    const k = b.firstElementChild.getBoundingClientRect()
    return k.left >= t.left - 0.5 && k.right <= t.right + 0.5
  })
)
check(knobOk, 'toggle knobs stay inside their tracks at 105% scale')
await api(() => window.zenith.settings.set({ appearance: { uiScale: 100 } }))
await page.getByRole('button', { name: 'Paper' }).click()
await page.waitForTimeout(300)
await shot('09-light-theme')
const s = await api(() => window.zenith.settings.get())
check(s.appearance.theme === 'light' && s.appearance.accent === '#38c8f5', 'appearance settings persisted')
await api(() => window.zenith.settings.set({ appearance: { theme: 'dark', accent: '#ff6b2c' } }))

// Backup & restore round-trip.
const backup = await api(() => window.zenith.data.backupNow())
check(backup.size > 0, `backup written (${backup.name})`)
await api((id) => window.zenith.games.remove(id), pq.id)
check((await api(() => window.zenith.games.list())).length === 2, 'game removed')
await api((p) => window.zenith.data.restore(p), backup.path)
await page.waitForLoadState('domcontentloaded')
await until(async () => (await window.zenith.games.list()).length === 3)
const restored = await api((id) => window.zenith.games.list().then((l) => l.find((g) => g.id === id)), pq.id)
check(!!restored && restored.playtimeSec >= 2 && restored.favorite, 'restore brings back game, playtime and favorite')

// Persistence across restarts.
await app.close()
const app2 = await electron.launch({ executablePath: require('electron'), args: [root], env: { ...process.env, ZENITH_USER_DATA: userData } })
const page2 = await app2.firstWindow()
await page2.waitForFunction(() => !!window.zenith)
const persisted = await page2.evaluate(() => window.zenith.games.list())
check(persisted.length === 3, 'library persists across restarts')
await app2.close()

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
