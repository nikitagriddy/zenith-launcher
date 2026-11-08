// Launch modes: what Zenith changes for one play session (launch options, CPU priority, GPU, power plan).
import path from 'node:path'
import { findUserSettings, potatoEdits } from './ueconfig'
import { SOURCE_LABELS, type Game, type GameEngine, type LaunchPlan, type LaunchProfileId, type Settings } from '@shared/types'

export const PROFILES: LaunchProfileId[] = ['default', 'boost', 'potato', 'custom']

/** Stores whose games start through a URI or client that can't take launch options. */
const NO_ARGS_SOURCES = new Set(['epic', 'ubisoft', 'riot', 'battlenet'])

export function resolveProfile(game: Game, settings: Settings, requested?: LaunchProfileId): LaunchProfileId {
  if (requested && PROFILES.includes(requested)) return requested
  if (game.launchProfile && PROFILES.includes(game.launchProfile)) return game.launchProfile
  return settings.launch.defaultProfile
}

function resolution(s: Settings['launch']): [number, number] | null {
  const m = /^(\d+)x(\d+)$/.exec(s.potatoResolution)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** Lowest-quality launch options in the engine's own command-line language. */
function potatoTokens(engine: GameEngine, s: Settings['launch']): { tokens: string[]; applies: string[] } {
  const res = resolution(s)
  const resLine = res ? `Resolution ${res[0]}×${res[1]}` : ''
  switch (engine.id) {
    case 'unreal': {
      const scale = Math.round(s.potatoRenderScale)
      const cmds = [
        `sg.ResolutionQuality ${scale}`,
        ...['ViewDistance', 'AntiAliasing', 'Shadow', 'GlobalIllumination', 'Reflection', 'PostProcess', 'Texture', 'Effects', 'Foliage', 'Shading'].map(
          (q) => `sg.${q}Quality 0`
        )
      ]
      const tokens: string[] = []
      const applies: string[] = []
      // Console commands at launch are the one option an anti-cheat could object to, so protected games skip them.
      if (!engine.antiCheat) {
        // Exact form Unreal parses: -ExecCmds="cmd 1,cmd 2" (the quotes must wrap only the value).
        tokens.push(`-ExecCmds="${cmds.join(',')}"`)
        applies.push(`Lowest graphics settings, ${scale}% render scale`)
      }
      if (res) {
        tokens.push(`-ResX=${res[0]}`, `-ResY=${res[1]}`)
        applies.push(resLine)
      }
      return { tokens, applies }
    }
    case 'unity': {
      const year = Number((engine.version ?? '').split('.')[0])
      // Unity's default quality level names changed in 2019; an unknown name is simply ignored by the game.
      const lowest = year >= 2019 ? '"Very Low"' : 'Fastest'
      const tokens = [`-screen-quality ${lowest}`]
      if (res) tokens.push(`-screen-width ${res[0]}`, `-screen-height ${res[1]}`)
      return { tokens, applies: ['Lowest quality level (if the game uses Unity’s standard levels)', ...(resLine ? [resLine] : [])] }
    }
    case 'source':
    case 'source2':
      return res ? { tokens: [`-w ${res[0]}`, `-h ${res[1]}`], applies: [resLine] } : { tokens: [], applies: [] }
    case 'godot':
      return res ? { tokens: [`--resolution ${res[0]}x${res[1]}`], applies: [resLine] } : { tokens: [], applies: [] }
    default:
      return { tokens: [], applies: [] }
  }
}

/** `nvidia`: true / false when known, null while the first driver check is still running. */
export function buildPlan(game: Game, profile: LaunchProfileId, settings: Settings, engine: GameEngine, nvidia: boolean | null = null): LaunchPlan {
  const s = settings.launch
  const plan: LaunchPlan = { profile, tokens: [], priority: 'normal', gpu: false, powerPlan: false, driverTweak: 'none', driverLodBias: null, driverExe: '', settingsFile: '', settingsEdits: [], engine, applies: [], limits: [], summary: '' }
  const argsBlocked = NO_ARGS_SOURCES.has(game.source)
  const exe = path.basename(engine.realExe || game.exePath)
  const boost = (tweak: 'boost' | 'potato' = 'boost') => {
    if (s.boostPriority) {
      if (engine.antiCheat) {
        // Changing priority means opening the running game's process, which is what anti-cheat watches for.
        plan.limits.push(`Uses ${engine.antiCheat}, so Zenith leaves its CPU priority alone.`)
      } else {
        plan.priority = 'high'
        plan.applies.push('Top CPU priority for the game')
      }
    }
    if (s.boostGpu) {
      plan.gpu = true
      plan.applies.push('Runs on your high-performance GPU')
    }
    if (s.boostPowerPlan) {
      plan.powerPlan = true
      plan.applies.push('High performance power plan while you play')
    }
    if (s.boostNvidia && nvidia && exe) {
      plan.driverTweak = tweak
      plan.driverExe = exe
      plan.applies.push(tweak === 'potato' ? 'NVIDIA: maximum performance and fastest texture filtering' : 'NVIDIA: maximum performance')
    }
  }

  if (profile === 'default') {
    plan.applies.push('Launches exactly as the game is set up')
    plan.summary = 'Exactly as the game is set up'
    return plan
  }

  if (profile === 'boost') {
    boost()
    if (!plan.applies.length && !plan.limits.length) plan.limits.push('All Boost options are turned off in Settings › Launch modes.')
    plan.summary = plan.applies.length ? 'Same graphics, more speed' : 'Nothing to change'
    return plan
  }

  if (profile === 'custom') {
    const raw = s.customArgs.trim()
    if (raw && !argsBlocked) {
      plan.tokens.push(raw)
      plan.applies.push(`Launch options: ${raw}`)
    } else if (!raw) plan.limits.push('No custom launch options set yet (Settings › Launch modes).')
    if (s.customBoost) boost()
  } else {
    // Potato: the engine's lowest settings plus everything in Boost.
    const p = potatoTokens(engine, s)
    // Clay textures are a hidden driver setting some online games ban for, so they only run after the user opted in.
    if (s.clayEnabled && nvidia && exe) {
      plan.driverLodBias = s.clayStrength
      plan.driverExe = exe
      plan.applies.push(`NVIDIA driver: clay textures at +${s.clayStrength / 8} for this game, removed when it closes`)
      plan.limits.push('Clay textures are on. They use a hidden NVIDIA setting some online games ban for.')
    } else if (s.clayEnabled && nvidia === false) {
      plan.limits.push('Clay textures need an NVIDIA graphics card.')
    }
    // Unreal games: the game's own settings file (what its Graphics menu saves), set back after the session.
    const settingsFile = engine.id === 'unreal' ? findUserSettings(engine.realExe) : null
    if (settingsFile) {
      try {
        const res = resolution(s)
        plan.settingsEdits = potatoEdits(settingsFile, {
          renderScale: Math.round(s.potatoRenderScale),
          resolution: res,
          fortnite: /fortniteclient/i.test(engine.realExe ?? '')
        })
        plan.settingsFile = settingsFile
        plan.applies.push(
          `Game settings: lowest graphics, ${Math.round(s.potatoRenderScale)}% 3D resolution${res ? `, ${res[0]}×${res[1]}` : ''}, fullscreen (your settings come back when the game closes)`
        )
      } catch {
        /* unreadable settings file: fall back to launch options only */
      }
    } else if (engine.id === 'unreal' && (argsBlocked || engine.antiCheat)) {
      plan.limits.push('Start the game once normally so its settings file exists; Potato can use it next time.')
    }
    const driverNote = plan.settingsEdits.length
      ? 'Zenith uses the game’s settings file instead'
      : plan.driverLodBias
        ? 'only textures are lowered, through the NVIDIA driver'
        : 'in-game graphics stay as they are'
    if (argsBlocked && p.tokens.length) {
      if (!plan.settingsEdits.length) plan.limits.push(`${SOURCE_LABELS[game.source]} doesn't accept launch options, so ${driverNote}.`)
    } else if (engine.id === 'unknown') {
      plan.limits.push(`Engine not recognized, so ${driverNote}.`)
    } else {
      plan.tokens.push(...p.tokens)
      // With the settings file in play, the launch options only back it up; don't list the same change twice.
      if (!plan.settingsEdits.length) {
        plan.applies.push(...p.applies.map((a, i) => (i === 0 ? `${engine.label}: ${a.charAt(0).toLowerCase()}${a.slice(1)}` : a)))
      }
    }
    boost('potato')
  }

  if (argsBlocked && profile === 'custom' && s.customArgs.trim()) {
    plan.limits.push(`${SOURCE_LABELS[game.source]} doesn't accept launch options.`)
  }
  const graphics = plan.tokens.length > 0 || plan.settingsEdits.length > 0
  const textures = plan.driverLodBias !== null
  plan.summary =
    profile === 'potato'
      ? graphics
        ? `Lowest graphics${resolution(s) ? `, ${s.potatoResolution.replace('x', '×')}` : ''}${textures ? ', clay textures' : ''}, plus Boost`
        : textures
          ? 'Clay textures through the NVIDIA driver, plus Boost'
          : 'Boost only for this game'
      : graphics
        ? `Your launch options${s.customBoost && plan.applies.length > 1 ? ', plus Boost' : ''}`
        : s.customArgs.trim()
          ? 'Boost only for this game'
          : 'Add your launch options in Settings'
  return plan
}
