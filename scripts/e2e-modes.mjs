// Launch-mode test: fake Unreal / Unity games whose "game.exe" is a renamed cmd.exe that writes down the exact
// command line it received, so we can check what Zenith passes, plus CPU priority and the GPU preference.
// Usage: npm run build && node scripts/e2e-modes.mjs   (screenshots in .e2e-modes/shots)
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const root = resolve('.e2e-modes')
rmSync(root, { recursive: true, force: true })
const shots = join(root, 'shots')
const sys32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const ue = join(root, 'Games', 'Starfall')
const unity = join(root, 'Games', 'Pixel Drift')
for (const d of [shots, join(ue, 'Engine', 'Binaries'), join(ue, 'Starfall', 'Binaries', 'Win64'), join(unity, 'PixelDrift_Data')]) mkdirSync(d, { recursive: true })
copyFileSync(join(sys32, 'cmd.exe'), join(ue, 'Starfall.exe'))
copyFileSync(join(sys32, 'PING.EXE'), join(ue, 'Starfall', 'Binaries', 'Win64', 'Starfall-Win64-Shipping.exe'))
copyFileSync(join(sys32, 'cmd.exe'), join(unity, 'PixelDrift.exe'))
writeFileSync(join(unity, 'UnityPlayer.dll'), 'x')
writeFileSync(join(unity, 'PixelDrift_Data', 'globalgamemanagers'), Buffer.concat([Buffer.alloc(20), Buffer.from('2022.3.10f1\0'), Buffer.alloc(200)]))

// The fake game keeps running ~5 s and ignores whatever options follow "rem"; we read its real command line from Windows.
const recorder = () => '/c ping -n 9 127.0.0.1>nul&rem'
const cmdline = (name) => {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='${name}'" | Select-Object -First 1).CommandLine`]).toString().trim()
  } catch {
    return ''
  }
}

let bad = 0
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`)
  if (!c) bad++
}
const GPU_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const gpuPref = (exe) => {
  try {
    return execFileSync('reg', ['query', GPU_KEY, '/v', exe], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().includes('GpuPreference=2')
  } catch {
    return false
  }
}
const priority = (name) => {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Name '${name}' -ErrorAction Stop | Select-Object -First 1).PriorityClass`]).toString().trim()
  } catch {
    return ''
  }
}

const nvdrs = (...a) => {
  try {
    return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('resources', 'nvdrs.ps1'), ...a]).toString()
  } catch (e) {
    return String(e.stdout ?? e)
  }
}
const lodBias = (exe) => /value\.0x00738E8F=custom:(\d+)/.exec(nvdrs('get', exe, '0x00738E8F'))?.[1] ?? null
const hasProfile = (exe) => !nvdrs('get', exe, '0x00738E8F').includes('profile=none')
const launchApp = () => _electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, ZENITH_USER_DATA: join(root, 'user') } })

const app = await _electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, ZENITH_USER_DATA: join(root, 'user') } })
const p = await app.firstWindow()
await p.getByText('is empty.').waitFor({ timeout: 20000 })
const api = (fn, arg) => p.evaluate(fn, arg)
const until = async (fn, arg, ms = 20000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await api(fn, arg).catch(() => false)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('timed out')
}
await api(() =>
  window.zenith.settings.set({ general: { minimizeOnLaunch: false }, discord: { enabled: false }, library: { autoArtwork: false }, launch: { boostPowerPlan: false } })
)

const add = (o) => api((x) => window.zenith.games.add(x), o)
const sf = await add({ title: 'Starfall', exePath: join(ue, 'Starfall.exe'), launchArgs: recorder() })
const pd = await add({ title: 'Pixel Drift', exePath: join(unity, 'PixelDrift.exe'), launchArgs: recorder() })
mkdirSync(join(root, 'Plain'), { recursive: true })
copyFileSync(join(sys32, 'PING.EXE'), join(root, 'Plain', 'PlainGame.exe'))
const plain = await add({ title: 'Plain Game', exePath: join(root, 'Plain', 'PlainGame.exe') })
const epic = await add({ title: 'Epic Thing', exePath: join(ue, 'Starfall.exe'), source: 'epic', launchUri: 'com.epicgames.launcher://apps/x?action=launch' })

// ---- engine detection + plans ----
const sfPlans = await api((id) => window.zenith.games.launchPlans(id), sf.id)
check(sfPlans.potato.engine.id === 'unreal' && /Shipping\.exe$/.test(sfPlans.potato.engine.realExe ?? ''), `Unreal detected, real exe found (${sfPlans.potato.engine.label})`)
check(
  sfPlans.potato.tokens.some((t) => t.startsWith('-ExecCmds="sg.ResolutionQuality 50,') && t.endsWith('sg.ShadingQuality 0"')) &&
    sfPlans.potato.tokens.includes('-ResX=1280') &&
    sfPlans.potato.tokens.includes('-ResY=720'),
  'Potato on Unreal: scalability 0, 50% render scale, 1280×720'
)
check(sfPlans.default.tokens.length === 0 && sfPlans.default.priority === 'normal' && !sfPlans.default.gpu, 'Default mode changes nothing')
check(sfPlans.boost.tokens.length === 0 && sfPlans.boost.priority === 'high' && sfPlans.boost.gpu, 'Boost: priority + GPU, same graphics')
const pdPlans = await api((id) => window.zenith.games.launchPlans(id), pd.id)
check(pdPlans.potato.engine.label === 'Unity 2022.3.10', `Unity version read from data files (${pdPlans.potato.engine.label})`)
check(pdPlans.potato.tokens.includes('-screen-quality "Very Low"') && pdPlans.potato.tokens.includes('-screen-width 1280'), 'Potato on Unity: lowest quality + 1280×720')
const plainPlans = await api((id) => window.zenith.games.launchPlans(id), plain.id)
check(plainPlans.potato.tokens.length === 0 && plainPlans.potato.limits.some((l) => /not recognized/.test(l)), 'Unknown engine: honest "graphics stay as they are"')
const epicPlans = await api((id) => window.zenith.games.launchPlans(id), epic.id)
check(epicPlans.potato.tokens.length === 0 && epicPlans.potato.limits.some((l) => /Epic Games doesn't accept/.test(l)), 'Epic game: says launch options can’t be passed')
check(sfPlans.potato.driverLodBias === 20 && sfPlans.potato.driverExe === 'Starfall-Win64-Shipping.exe', 'Potato on NVIDIA: clay textures (+2.5) on the real game exe')
check(epicPlans.potato.driverLodBias === 20 && epicPlans.potato.limits.some((l) => /only textures are lowered/.test(l)), 'Epic game still gets clay textures through the driver')
check(sfPlans.boost.driverLodBias === null && sfPlans.default.driverLodBias === null, 'Boost and Default never touch the driver')
await api(() => window.zenith.settings.set({ launch: { potatoResolution: 'native', potatoRenderScale: 70 } }))
const sfNative = await api((id) => window.zenith.games.launchPlans(id), sf.id)
check(sfNative.potato.tokens.join(' ').includes('sg.ResolutionQuality 70') && !sfNative.potato.tokens.some((t) => t.startsWith('-ResX')), 'Settings change the plan (native res, 70% scale)')
await api(() => window.zenith.settings.set({ launch: { potatoResolution: '1280x720', potatoRenderScale: 50 } }))

// ---- real launch through the picker: exact command line, priority, GPU preference ----
await p.getByRole('button', { name: 'Library' }).first().click()
await p.getByText('Starfall').first().click()
await p.getByRole('button', { name: 'Choose launch mode' }).click()
await p.getByRole('menuitem', { name: /Potato/ }).hover()
await p.waitForTimeout(400)
await p.screenshot({ path: join(shots, 'picker.png') })
await p.getByText('Always launch Starfall this way').click()
await p.getByRole('menuitem', { name: /Potato/ }).click()
await until(async (id) => (await window.zenith.games.running()).some((r) => r.gameId === id), sf.id)
await p.waitForTimeout(700)
const line = cmdline('Starfall.exe')
await p.waitForTimeout(3100)
const clayDuring = lodBias('Starfall-Win64-Shipping.exe')
check(clayDuring === '20', `NVIDIA driver profile has clay textures while playing (LOD bias value ${clayDuring})`)
check(priority('Starfall') === 'High', `Boosted game runs at High CPU priority (${priority('Starfall') || 'not found'})`)
check(gpuPref(join(ue, 'Starfall.exe')) && gpuPref(join(ue, 'Starfall', 'Binaries', 'Win64', 'Starfall-Win64-Shipping.exe')), 'High-performance GPU set for the game and its real exe')
await p.screenshot({ path: join(shots, 'running.png') })
await until(async (id) => (await window.zenith.games.running()).every((r) => r.gameId !== id), sf.id, 30000)
console.log('      game received:', line)
check(line.startsWith(`"${join(ue, 'Starfall.exe')}"`), 'exe path is quoted exactly once')
check(line.includes('-ExecCmds="sg.ResolutionQuality 50,sg.ViewDistanceQuality 0,') && line.includes('-ResX=1280 -ResY=720'), 'game got -ExecCmds="…" verbatim (quotes intact)')
check(!gpuPref(join(ue, 'Starfall.exe')) && !gpuPref(join(ue, 'Starfall', 'Binaries', 'Win64', 'Starfall-Win64-Shipping.exe')), 'GPU preference removed after the game closed')
const saved = (await api(() => window.zenith.games.list())).find((g) => g.id === sf.id)
check(saved.launchProfile === 'potato', '"Always launch this way" saved Potato for the game')
await new Promise((r) => setTimeout(r, 4000))
check(!hasProfile('Starfall-Win64-Shipping.exe'), 'driver profile Zenith made is removed after the game closed')
await p.waitForTimeout(500)
await p.screenshot({ path: join(shots, 'play-button.png') })

// ---- default mode really passes nothing extra ----
await api((id) => window.zenith.games.launch(id, 'default'), pd.id)
await p.waitForTimeout(1500)
const pdLine = cmdline('PixelDrift.exe')
console.log('      default launch got:', pdLine)
await until(async (id) => (await window.zenith.games.running()).every((r) => r.gameId !== id), pd.id, 30000)
check(pdLine.endsWith('&rem') && !pdLine.includes('-screen'), 'Default launch adds no options')
check(cmdline('PixelDrift.exe') === '', 'process gone after the session')

await p.getByRole('button', { name: 'Settings' }).first().click()
await p.getByRole('button', { name: 'Launch modes' }).click()
await p.waitForTimeout(600)
await p.screenshot({ path: join(shots, 'settings.png'), fullPage: false })
// ---- crash recovery: kill Zenith mid-game, restart, the driver tweak is cleaned up ----
await api((id) => window.zenith.games.launch(id, 'potato'), pd.id)
await until(async (id) => (await window.zenith.games.running()).some((r) => r.gameId === id), pd.id)
await new Promise((r) => setTimeout(r, 1000))
check(lodBias('PixelDrift.exe') === '20', 'clay textures on for the Unity game')
execFileSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], { stdio: 'ignore' })
// Let the killed instance's helper processes exit so the single-instance lock is free.
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500))
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', `if (Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*e2e-modes*' }) { exit 1 }`])
    break
  } catch {}
}
check(lodBias('PixelDrift.exe') === '20', 'after a crash the setting is still there (expected)')
const app2 = await launchApp()
await (await app2.firstWindow()).waitForFunction(() => !!window.zenith)
let cleaned = false
for (let i = 0; i < 40 && !cleaned; i++) {
  await new Promise((r) => setTimeout(r, 500))
  cleaned = !hasProfile('PixelDrift.exe')
}
check(cleaned, 'next start removes the leftover driver setting')
await app2.close()
console.log(bad ? `\n${bad} check(s) failed` : '\nAll launch-mode checks passed')
process.exit(bad ? 1 : 0)
