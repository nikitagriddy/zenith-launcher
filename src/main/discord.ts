// Discord Rich Presence over Discord's local IPC pipe (no extra dependency).
// Frame format: int32 LE opcode, int32 LE length, UTF-8 JSON.
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { SOURCE_LABELS, type DiscordStatus, type Game, type Settings } from '@shared/types'
import { steamAssets } from './artwork'
import { steamAppIdFor } from './extras'
import { log } from './log'

export const DEFAULT_DISCORD_CLIENT_ID = '1567203815143379104'
const LOGO_URL = 'https://raw.githubusercontent.com/nikitagriddy/zenith-launcher/main/build/icon.png'
const RELEASES_URL = 'https://github.com/nikitagriddy/zenith-launcher/releases/latest'

enum Op {
  Handshake = 0,
  Frame = 1,
  Close = 2,
  Ping = 3,
  Pong = 4
}

export interface PresenceGame {
  game: Game
  startedAt: number
}

type Opts = Settings['discord']

class DiscordPresence {
  private socket: net.Socket | null = null
  private ready = false
  private buffer = Buffer.alloc(0)
  private retry: NodeJS.Timeout | null = null
  private opts: Opts | null = null
  private current: PresenceGame | null = null
  private browsing = false
  private status: DiscordStatus = { state: 'off' }
  private artCache = new Map<string, string>()
  private onStatus: (s: DiscordStatus) => void = () => undefined
  private connectedId = ''

  init(onStatus: (s: DiscordStatus) => void): void {
    this.onStatus = onStatus
  }

  getStatus(): DiscordStatus {
    return this.status
  }

  private setStatus(s: DiscordStatus): void {
    this.status = s
    this.onStatus(s)
  }

  private clientId(): string {
    return (this.opts?.clientId || DEFAULT_DISCORD_CLIENT_ID).trim()
  }

  configure(opts: Opts): void {
    const idChanged = this.opts && this.clientId() !== (opts.clientId || DEFAULT_DISCORD_CLIENT_ID).trim()
    this.opts = opts
    if (!opts.enabled) {
      this.disconnect()
      this.setStatus({ state: 'off' })
      return
    }
    if (idChanged) this.disconnect()
    if (!this.socket) this.connect()
    else void this.push()
  }

  setPlaying(p: PresenceGame | null): void {
    this.current = p
    void this.push()
  }

  setBrowsing(on: boolean): void {
    this.browsing = on
    void this.push()
  }

  // ---------- connection ----------

  private connect(index = 0): void {
    if (!this.opts?.enabled || this.socket) return
    if (!/^\d{15,22}$/.test(this.clientId())) {
      this.setStatus({ state: 'error', message: 'The Discord Application ID should be a long number.' })
      return
    }
    if (index > 9) {
      this.setStatus({ state: 'waiting', message: 'Discord is not running.' })
      this.scheduleRetry()
      return
    }
    const sock = net.createConnection(`\\\\?\\pipe\\discord-ipc-${index}`)
    let opened = false
    sock.once('connect', () => {
      opened = true
      this.socket = sock
      this.buffer = Buffer.alloc(0)
      this.connectedId = this.clientId()
      this.send(Op.Handshake, { v: 1, client_id: this.connectedId })
    })
    sock.on('data', (chunk) => this.onData(chunk))
    sock.once('error', () => {
      if (!opened) {
        sock.destroy()
        this.connect(index + 1)
      }
    })
    sock.once('close', () => {
      if (!opened) return
      const wasReady = this.ready
      this.socket = null
      this.ready = false
      if (this.opts?.enabled) {
        if (this.status.state !== 'error') this.setStatus({ state: 'waiting', message: wasReady ? 'Lost connection to Discord.' : 'Discord is not running.' })
        this.scheduleRetry()
      }
    })
  }

  private scheduleRetry(): void {
    if (this.retry) return
    this.retry = setTimeout(() => {
      this.retry = null
      this.connect()
    }, 15_000)
  }

  private disconnect(): void {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const s = this.socket
    this.socket = null
    this.ready = false
    if (s) {
      try {
        this.writeFrame(s, Op.Close, {})
      } catch {
        /* ignore */
      }
      s.destroy()
    }
  }

  private writeFrame(sock: net.Socket, op: Op, payload: unknown): void {
    const json = Buffer.from(JSON.stringify(payload), 'utf8')
    const header = Buffer.alloc(8)
    header.writeInt32LE(op, 0)
    header.writeInt32LE(json.length, 4)
    sock.write(Buffer.concat([header, json]))
  }

  private send(op: Op, payload: unknown): void {
    if (this.socket) this.writeFrame(this.socket, op, payload)
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0)
      const len = this.buffer.readInt32LE(4)
      if (this.buffer.length < 8 + len) return
      let msg: any = null
      try {
        msg = JSON.parse(this.buffer.subarray(8, 8 + len).toString('utf8'))
      } catch {
        /* ignore malformed frame */
      }
      this.buffer = this.buffer.subarray(8 + len)
      this.onMessage(op, msg)
    }
  }

  private onMessage(op: number, msg: any): void {
    if (op === Op.Ping) return this.send(Op.Pong, msg)
    if (op === Op.Close) {
      const bad = msg?.code === 4000 || /client id/i.test(msg?.message ?? '')
      this.setStatus({ state: 'error', message: bad ? 'Discord rejected the Application ID.' : (msg?.message ?? 'Discord closed the connection.') })
      return
    }
    if (msg?.evt === 'READY') {
      this.ready = true
      const u = msg.data?.user
      this.setStatus({ state: 'connected', user: u ? u.global_name || u.username : undefined })
      void this.push()
    } else if (msg?.evt === 'ERROR') {
      log.warn('Discord RPC error', msg.data)
      this.setStatus({ state: 'error', message: msg.data?.message ?? 'Discord refused the status update.' })
    }
  }

  // ---------- activity ----------

  private async artFor(game: Game): Promise<string> {
    const key = `${game.id}:${game.title}`
    const hit = this.artCache.get(key)
    if (hit !== undefined) return hit
    let url = ''
    try {
      const appid = await steamAppIdFor(game)
      if (appid) {
        const a = await steamAssets(appid)
        url = a.cover[0] || a.hero[0] || `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`
      }
    } catch {
      /* offline: fall back to the Zenith logo */
    }
    this.artCache.set(key, url)
    return url
  }

  private async buildActivity(): Promise<Record<string, unknown> | null> {
    const o = this.opts
    if (!o) return null
    if (this.current) {
      const { game, startedAt } = this.current
      const parts: string[] = []
      if (o.showStore && game.source !== 'manual' && game.source !== 'scan' && game.source !== 'import') parts.push(`on ${SOURCE_LABELS[game.source]}`)
      if (o.showPlaytime && game.playtimeSec >= 3600) parts.push(`${Math.floor(game.playtimeSec / 3600)}h played`)
      const art = await this.artFor(game)
      const activity: Record<string, unknown> = {
        type: 0,
        details: game.title.slice(0, 128),
        state: (parts.join(' · ') || 'via Zenith').slice(0, 128),
        // Show the game (not "Zenith") in the member list where Discord supports it.
        status_display_type: 2,
        assets: {
          large_image: art || LOGO_URL,
          large_text: game.title.slice(0, 128),
          ...(art ? { small_image: LOGO_URL, small_text: 'Zenith launcher' } : {})
        },
        instance: false
      }
      if (o.showElapsed) activity.timestamps = { start: startedAt }
      if (o.showButton) activity.buttons = [{ label: 'Get Zenith', url: RELEASES_URL }]
      return activity
    }
    if (o.showBrowsing && this.browsing) {
      return { type: 0, details: 'Browsing the library', state: 'Picking a game', assets: { large_image: LOGO_URL, large_text: 'Zenith launcher' } }
    }
    return null
  }

  private pushing = false
  private again = false

  private async push(): Promise<void> {
    if (!this.socket || !this.ready) return
    if (this.pushing) {
      this.again = true
      return
    }
    this.pushing = true
    try {
      do {
        this.again = false
        const activity = await this.buildActivity()
        this.send(Op.Frame, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: randomUUID() })
        if (this.status.state === 'connected' || this.status.state === 'playing') {
          this.setStatus({ ...this.status, state: activity && this.current ? 'playing' : 'connected', game: this.current?.game.title })
        }
      } while (this.again)
    } finally {
      this.pushing = false
    }
  }

  shutdown(): void {
    if (this.socket && this.ready) this.send(Op.Frame, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() })
    this.disconnect()
  }
}

export const discord = new DiscordPresence()
