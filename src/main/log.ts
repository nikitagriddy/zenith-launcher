import fs from 'node:fs'
import path from 'node:path'

let logFile = ''

export function initLog(dataDir: string): void {
  const dir = path.join(dataDir, 'logs')
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'main.log')
  try {
    // Keep the log small: rotate once it passes 2 MB.
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
      fs.renameSync(logFile, path.join(dir, 'main.old.log'))
    }
  } catch {
    /* ignore */
  }
}

function fmt(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? arg.message
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function write(level: string, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${level} ${args.map(fmt).join(' ')}`
  if (level === 'ERROR') console.error(line)
  else console.log(line)
  if (!logFile) return
  try {
    fs.appendFileSync(logFile, line + '\n')
  } catch {
    /* ignore */
  }
}

export const log = {
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args)
}
