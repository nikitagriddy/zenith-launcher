// Bundles the Electron main + preload processes with esbuild.
import { build, context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

export function options(dev = false) {
  const common = {
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron', 'sql.js', 'electron-updater'],
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    logLevel: 'info',
    alias: { '@shared': resolve(root, 'src/shared') }
  }
  return [
    { ...common, entryPoints: [resolve(root, 'src/main/index.ts')], outfile: resolve(root, 'out/main/index.js') },
    { ...common, entryPoints: [resolve(root, 'src/preload/index.ts')], outfile: resolve(root, 'out/preload/index.js') }
  ]
}

export async function watch(onRebuild) {
  const ctxs = await Promise.all(
    options(true).map((o) =>
      context({
        ...o,
        plugins: [{ name: 'notify', setup: (b) => b.onEnd((r) => r.errors.length === 0 && onRebuild?.()) }]
      })
    )
  )
  await Promise.all(ctxs.map((c) => c.watch()))
  return ctxs
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await Promise.all(options(false).map((o) => build(o)))
}
