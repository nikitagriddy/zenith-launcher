// Launch modes: what Zenith changes for one play session (launch options, CPU priority, GPU, power plan).
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
      // Exact form Unreal parses: -ExecCmds="cmd 1,cmd 2" (the quotes must wrap only the value).
      const tokens = [`-ExecCmds="${cmds.join(',')}"`]
      if (res) tokens.push(`-ResX=${res[0]}`, `-ResY=${res[1]}`)
      return { tokens, applies: [`Lowest graphics settings, ${scale}% render scale`, ...(resLine ? [resLine] : [])] }
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

export function buildPlan(game: Game, profile: LaunchProfileId, settings: Settings, engine: GameEngine): LaunchPlan {
  const s = settings.launch
  const plan: LaunchPlan = { profile, tokens: [], priority: 'normal', gpu: false, powerPlan: false, engine, applies: [], limits: [], summary: '' }
  const argsBlocked = NO_ARGS_SOURCES.has(game.source)
  const boost = () => {
    if (s.boostPriority) {
      plan.priority = 'high'
      plan.applies.push('Top CPU priority for the game')
    }
    if (s.boostGpu) {
      plan.gpu = true
      plan.applies.push('Runs on your high-performance GPU')
    }
    if (s.boostPowerPlan) {
      plan.powerPlan = true
      plan.applies.push('High performance power plan while you play')
    }
  }

  if (profile === 'default') {
    plan.applies.push('Launches exactly as the game is set up')
    plan.summary = 'Exactly as the game is set up'
    return plan
  }

  if (profile === 'boost') {
    boost()
    if (!plan.applies.length) plan.limits.push('All Boost options are turned off in Settings › Launch modes.')
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
    if (argsBlocked && p.tokens.length) {
      plan.limits.push(`${SOURCE_LABELS[game.source]} doesn't accept launch options, so in-game graphics stay as they are.`)
    } else if (engine.id === 'unknown') {
      plan.limits.push('Engine not recognized, so in-game graphics stay as they are.')
    } else {
      plan.tokens.push(...p.tokens)
      plan.applies.push(...p.applies.map((a, i) => (i === 0 ? `${engine.label}: ${a.charAt(0).toLowerCase()}${a.slice(1)}` : a)))
    }
    boost()
  }

  if (argsBlocked && profile === 'custom' && s.customArgs.trim()) {
    plan.limits.push(`${SOURCE_LABELS[game.source]} doesn't accept launch options.`)
  }
  const graphics = plan.tokens.length > 0
  plan.summary =
    profile === 'potato'
      ? graphics
        ? `Lowest graphics${resolution(s) ? `, ${s.potatoResolution.replace('x', '×')}` : ''}, plus Boost`
        : 'Boost only for this game'
      : graphics
        ? `Your launch options${s.customBoost && plan.applies.length > 1 ? ', plus Boost' : ''}`
        : s.customArgs.trim()
          ? 'Boost only for this game'
          : 'Add your launch options in Settings'
  return plan
}
