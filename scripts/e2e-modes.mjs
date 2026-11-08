// Launch-mode test: fake Unreal / Unity games whose "game.exe" is a renamed cmd.exe that writes down the exact
// command line it received, so we can check what Zenith passes, plus CPU priority and the GPU preference.
// Usage: npm run build && node scripts/e2e-modes.mjs   (screenshots in .e2e-modes/shots)
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const root = resolve('.e2e-modes')
rmSync(root, { recursive: true, force: true })
const shots = join(root, 'shots')
const sys32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const ue = join(root, 'Games', 'Starfall')
const unity = join(root, 'Games', 'Pixel Drift')
// A fake Unreal game protected by anti-cheat: Zenith has to stay out of it.
const guardedDir = join(root, 'Games', 'Guarded')
for (const d of [shots, join(ue, 'Engine', 'Binaries'), join(ue, 'Starfall', 'Binaries', 'Win64'), join(unity, 'PixelDrift_Data'), join(guardedDir, 'Guarded', 'Binaries', 'Win64', 'EasyAntiCheat')]) mkdirSync(d, { recursive: true })
copyFileSync(join(sys32, 'cmd.exe'), join(guardedDir, 'Guarded.exe'))
copyFileSync(join(sys32, 'PING.EXE'), join(guardedDir, 'Guarded', 'Binaries', 'Win64', 'Guarded-Win64-Shipping.exe'))
copyFileSync(join(sys32, 'cmd.exe'), join(ue, 'Starfall.exe'))
copyFileSync(join(sys32, 'PING.EXE'), join(ue, 'Starfall', 'Binaries', 'Win64', 'Starfall-Win64-Shipping.exe'))
copyFileSync(join(sys32, 'cmd.exe'), join(unity, 'PixelDrift.exe'))
writeFileSync(join(unity, 'UnityPlayer.dll'), 'x')
// Fake %LOCALAPPDATA% with a Fortnite-style settings file for the fake Unreal game (your real one is never used).
const localApp = join(root, 'LocalAppData')
const iniDir = join(localApp, 'Starfall', 'Saved', 'Config', 'WindowsClient')
mkdirSync(iniDir, { recursive: true })
const ini = join(iniDir, 'GameUserSettings.ini')
const iniOriginal = [
  '[/Script/Starfall.StarfallUserSettings]', 'bMotionBlur=True', 'bShowGrass=True', 'ResolutionSizeX=1920', 'ResolutionSizeY=1080',
  'LastUserConfirmedResolutionSizeX=1920', 'LastUserConfirmedResolutionSizeY=1080', 'LastConfirmedFullscreenMode=1', 'PreferredFullscreenMode=1',
  'FrameRateLimit=240.000000', 'DesiredScreenWidth=1920', 'DesiredScreenHeight=1080',
  // Fortnite keeps its own 3D resolution lines and rebuilds sg.ResolutionQuality from them at startup.
  'TemporalSuperResolutionQuality=Recommended', 'PotentiallyUpscaledResolutionQuality=85.000000', 'NeverUpscaledResolutionQuality=75.000000', 'bUseDynamicResolution=True',
  '', '[ScalabilityGroups]', 'sg.ResolutionQuality=100',
  'sg.ViewDistanceQuality=3', 'sg.AntiAliasingQuality=3', 'sg.ShadowQuality=3', 'sg.GlobalIlluminationQuality=3', 'sg.ReflectionQuality=3',
  'sg.PostProcessQuality=3', 'sg.TextureQuality=3', 'sg.EffectsQuality=3', 'sg.FoliageQuality=3', 'sg.ShadingQuality=3', '', '[ChatSettings]', 'Volume=0.5', ''
].join('\r\n')
writeFileSync(ini, iniOriginal)
const iniVal = (key) => new RegExp('^' + key.replace('.', '\\.') + '=(.*)$', 'm').exec(readFileSync(ini, 'utf8'))?.[1]?.trim() ?? null
writeFileSync(join(unity, 'PixelDrift_Data', 'globalgamemanagers'), Buffer.concat([Buffer.alloc(20), Buffer.from('2022.3.10f1\0'), Buffer.alloc(200)]))

// The fake game keeps running ~5 s and ignores whatever options follow "rem"; we read its real command line from Windows.
const recorder = () => '/c ping -n 16 127.0.0.1>nul&rem'
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
/** All four clay settings as "neg,lod,quality,tss" (the full set the driver needs in DirectX 10+ games). */
const claySet = (exe) => {
  const out = nvdrs('get', exe, '0x0019BB68', '0x00738E8F', '0x00CE2691', '0x10D48A85')
  return ['0x0019BB68', '0x00738E8F', '0x00CE2691', '0x10D48A85'].map((id) => new RegExp('value\\.' + id + '=custom:(\\d+)').exec(out)?.[1] ?? '-').join(',')
}
const powerMode = (exe) => /value\.0x1057EB71=custom:(\d+)/.exec(nvdrs('get', exe, '0x1057EB71'))?.[1] ?? null
const hasProfile = (exe) => !nvdrs('get', exe, '0x00738E8F').includes('profile=none')
const launchApp = () => _electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, ZENITH_USER_DATA: join(root, 'user'), LOCALAPPDATA: localApp } })

const app = await _electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, ZENITH_USER_DATA: join(root, 'user'), LOCALAPPDATA: localApp } })
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
const defaults = (await api(() => window.zenith.settings.get())).launch
check(defaults.potatoResolution === 'native' && defaults.potatoRenderScale === 60 && defaults.clayEnabled === false && defaults.boostNvidia === true, 'Defaults: your resolution, 60% 3D, clay textures off')
await api(() =>
  window.zenith.settings.set({ general: { minimizeOnLaunch: false }, discord: { enabled: false }, library: { autoArtwork: false }, launch: { boostPowerPlan: false, potatoResolution: '1280x720', potatoRenderScale: 50 } })
)

const add = (o) => api((x) => window.zenith.games.add(x), o)
const sf = await add({ title: 'Starfall', exePath: join(ue, 'Starfall.exe'), launchArgs: recorder() })
const pd = await add({ title: 'Pixel Drift', exePath: join(unity, 'PixelDrift.exe'), launchArgs: recorder() })
mkdirSync(join(root, 'Plain'), { recursive: true })
copyFileSync(join(sys32, 'PING.EXE'), join(root, 'Plain', 'PlainGame.exe'))
const plain = await add({ title: 'Plain Game', exePath: join(root, 'Plain', 'PlainGame.exe') })
const epic = await add({ title: 'Epic Thing', exePath: join(ue, 'Starfall.exe'), source: 'epic', launchUri: 'com.epicgames.launcher://apps/x?action=launch' })
const guarded = await add({ title: 'Guarded', exePath: join(guardedDir, 'Guarded.exe'), launchArgs: recorder() })

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
check(epicPlans.potato.tokens.length === 0 && epicPlans.potato.settingsEdits.length > 0 && epicPlans.potato.limits.length === 0, 'Epic game: no launch options, real Potato through its settings file')
check(sfPlans.potato.driverLodBias === null && sfPlans.potato.driverTweak === 'potato' && sfPlans.potato.driverExe === 'Starfall-Win64-Shipping.exe', 'Potato on NVIDIA: official options on the real game exe, no clay unless asked')
check(epicPlans.potato.driverLodBias === null && epicPlans.potato.driverTweak === 'potato', 'Epic game: official NVIDIA options, no clay')
check(sfPlans.potato.settingsFile === ini && sfPlans.potato.applies.some((a) => /Game settings: lowest graphics, 50% 3D resolution, 1280×720, fullscreen/.test(a)), 'Unreal: Potato uses the game’s own settings file')
check(sfPlans.boost.settingsEdits.length === 0 && sfPlans.default.settingsEdits.length === 0, 'Boost and Default never touch the settings file')
check(sfPlans.boost.driverTweak === 'boost' && sfPlans.boost.driverLodBias === null, 'Boost: NVIDIA maximum performance, no clay')
check(sfPlans.default.driverTweak === 'none' && sfPlans.default.driverLodBias === null, 'Default never touches the driver')
await api(() => window.zenith.settings.set({ launch: { potatoResolution: 'native', potatoRenderScale: 70 } }))
const sfNative = await api((id) => window.zenith.games.launchPlans(id), sf.id)
check(sfNative.potato.tokens.join(' ').includes('sg.ResolutionQuality 70') && !sfNative.potato.tokens.some((t) => t.startsWith('-ResX')), 'Settings change the plan (native res, 70% scale)')
check(sfNative.potato.settingsEdits.some((e) => e.key === 'PreferredFullscreenMode' && e.value === '0') && !sfNative.potato.settingsEdits.some((e) => e.key === 'ResolutionSizeX'), 'Keep my resolution: real fullscreen, resolution lines left alone')
await api(() => window.zenith.settings.set({ launch: { potatoResolution: '1280x720', potatoRenderScale: 25, clayEnabled: true, clayStrength: 69 } }))
const capped = (await api((id) => window.zenith.games.launchPlans(id), sf.id)).potato
check(capped.driverLodBias === 20 && capped.limits.some((l) => /some online games ban/.test(l)), 'Clay is capped at +2.5 and the picker warns when it is on')
check(capped.settingsEdits.some((e) => e.key === 'sg.ResolutionQuality' && e.value === '50'), '3D resolution cannot go under 50%')
await api(() => window.zenith.settings.set({ launch: { potatoRenderScale: 50, clayEnabled: false, clayStrength: 10 } }))

// ---- anti-cheat: Zenith stays out of the running game ----
const acPlans = await api((id) => window.zenith.games.launchPlans(id), guarded.id)
check(acPlans.potato.engine.antiCheat === 'Easy Anti-Cheat', `Anti-cheat found in the game folder (${acPlans.potato.engine.antiCheat})`)
check(acPlans.boost.priority === 'normal' && acPlans.potato.priority === 'normal' && acPlans.boost.limits.some((l) => /leaves its CPU priority alone/.test(l)), 'Anti-cheat game: CPU priority left alone and the picker says why')
check(!acPlans.potato.tokens.some((t) => t.startsWith('-ExecCmds')) && acPlans.potato.tokens.includes('-ResX=1280'), 'Anti-cheat game: no console commands at launch, resolution options only')
check(acPlans.potato.limits.some((l) => /Start the game once normally/.test(l)), 'Anti-cheat game with no settings file yet: says to start it once')
check(acPlans.potato.driverTweak === 'potato' && acPlans.potato.driverLodBias === null, 'Anti-cheat game: official NVIDIA options, no clay')
await api((id) => window.zenith.games.launch(id, 'potato'), guarded.id)
await until(async (id) => (await window.zenith.games.running()).some((r) => r.gameId === id), guarded.id)
await new Promise((r) => setTimeout(r, 4000)) // past the first priority timer
const acLine = cmdline('Guarded.exe')
console.log('      protected game received:', acLine)
check(priority('Guarded') === 'Normal', `Protected game stays at Normal CPU priority (${priority('Guarded') || 'not found'})`)
check(!acLine.includes('-ExecCmds') && acLine.includes('-ResX=1280'), 'Protected game got no console commands')
const acDriver = claySet('Guarded-Win64-Shipping.exe')
check(powerMode('Guarded-Win64-Shipping.exe') === '1' && acDriver === '-,-,20,-', `Protected game: only the two Control Panel options in the driver (neg,lod,quality,tss = ${acDriver})`)
await until(async (id) => (await window.zenith.games.running()).every((r) => r.gameId !== id), guarded.id, 30000)
await new Promise((r) => setTimeout(r, 4000))
check(!hasProfile('Guarded-Win64-Shipping.exe'), 'Driver profile removed after the protected game closed')

// ---- clay textures need an explicit yes ----
await p.getByRole('button', { name: 'Settings' }).first().click()
await p.getByRole('button', { name: 'Launch modes' }).click()
const claySwitch = p.locator('div.justify-between', { hasText: 'Clay textures (NVIDIA)' }).last().getByRole('switch')
await claySwitch.scrollIntoViewIfNeeded()
await p.waitForTimeout(400)
await p.screenshot({ path: join(shots, 'potato-settings.png') })
await claySwitch.click()
await p.getByRole('button', { name: 'Turn on at my own risk' }).waitFor()
await p.waitForTimeout(400)
await p.screenshot({ path: join(shots, 'clay-warning.png') })
await p.getByRole('button', { name: 'Cancel' }).click()
await p.waitForTimeout(400)
check((await api(() => window.zenith.settings.get())).launch.clayEnabled === false, 'Clay warning: Cancel keeps it off')
await claySwitch.click()
await p.getByRole('button', { name: 'Turn on at my own risk' }).click()
await until(async () => (await window.zenith.settings.get()).launch.clayEnabled === true)
await p.waitForTimeout(300)
check((await p.getByText('Clay strength').count()) === 1, 'Clay warning: confirming turns it on and shows the strength slider')

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
check(iniVal('sg.ResolutionQuality') === '50' && iniVal('sg.ShadowQuality') === '0' && iniVal('ResolutionSizeX') === '1280' && iniVal('PreferredFullscreenMode') === '0' && iniVal('bMotionBlur') === 'False', 'settings file has Potato values while playing')
check(
  iniVal('NeverUpscaledResolutionQuality') === '50.000000' && iniVal('PotentiallyUpscaledResolutionQuality') === '50.000000' && iniVal('bUseDynamicResolution') === 'False' && iniVal('TemporalSuperResolutionQuality') === 'Recommended',
  'Fortnite-style 3D resolution lines set to 50% too, dynamic resolution off'
)
const clayFull = claySet('Starfall-Win64-Shipping.exe')
check(clayFull === '1,10,20,8', `after opting in: all four clay driver settings on while playing (neg,lod,quality,tss = ${clayFull})`)
check(powerMode('Starfall-Win64-Shipping.exe') === '1', 'NVIDIA Power management on maximum performance while playing')
check(iniVal('FrameRateLimit') === '240.000000' && iniVal('Volume') === '0.5' && readFileSync(ini, 'utf8').includes('\r\n'), 'other lines and Windows line endings left alone')
// Simulate the player changing a setting in-game and the game saving a new line on exit.
writeFileSync(ini, readFileSync(ini, 'utf8').replace('sg.TextureQuality=0', 'sg.TextureQuality=2').replace('Volume=0.5', 'Volume=0.5\r\nPushToTalk=True'))
check(clayDuring === '10', `NVIDIA driver profile has clay textures while playing (LOD bias value ${clayDuring})`)
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
check(iniVal('sg.ResolutionQuality') === '100' && iniVal('ResolutionSizeX') === '1920' && iniVal('PreferredFullscreenMode') === '1' && iniVal('bMotionBlur') === 'True', 'your own settings are back after the game closed')
check(iniVal('NeverUpscaledResolutionQuality') === '75.000000' && iniVal('PotentiallyUpscaledResolutionQuality') === '85.000000' && iniVal('bUseDynamicResolution') === 'True', 'Fortnite-style 3D resolution lines back to yours')
check(iniVal('sg.TextureQuality') === '2' && iniVal('PushToTalk') === 'True', 'in-game changes made during the session are kept')
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
await p.getByText('Is this safe for online games?').scrollIntoViewIfNeeded()
await p.waitForTimeout(400)
await p.screenshot({ path: join(shots, 'potato-card.png'), fullPage: false })
// ---- crash recovery: kill Zenith mid-game, restart, the driver tweak is cleaned up ----
await api((id) => window.zenith.games.launch(id, 'potato'), sf.id)
await until(async (id) => (await window.zenith.games.running()).some((r) => r.gameId === id), sf.id)
await new Promise((r) => setTimeout(r, 1000))
check(lodBias('Starfall-Win64-Shipping.exe') === '10' && iniVal('sg.ResolutionQuality') === '50', 'Potato on again for the crash test')
execFileSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], { stdio: 'ignore' })
// Let the killed instance's helper processes exit so the single-instance lock is free.
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500))
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', `if (Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*e2e-modes*' }) { exit 1 }`])
    break
  } catch {}
}
check(lodBias('Starfall-Win64-Shipping.exe') === '10' && iniVal('sg.ResolutionQuality') === '50', 'after a crash the changes are still there (expected)')
const app2 = await launchApp()
await (await app2.firstWindow()).waitForFunction(() => !!window.zenith)
let cleaned = false
for (let i = 0; i < 40 && !cleaned; i++) {
  await new Promise((r) => setTimeout(r, 500))
  cleaned = !hasProfile('Starfall-Win64-Shipping.exe') && iniVal('sg.ResolutionQuality') === '100' && !gpuPref(join(ue, 'Starfall.exe'))
}
check(cleaned, 'next start puts back the driver setting, the settings file and the GPU preference')
await app2.close()
console.log(bad ? `\n${bad} check(s) failed` : '\nAll launch-mode checks passed')
process.exit(bad ? 1 : 0)
