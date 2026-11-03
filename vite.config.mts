import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))

// Strict CSP for the packaged app only (Vite's dev server needs inline scripts for HMR).
const csp: Plugin = {
  name: 'zenith-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: zenith-media:",
      "font-src 'self' data:",
      "connect-src 'self' zenith-media:"
    ].join('; ')
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
  }
}

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react(), csp],
  resolve: {
    alias: { '@shared': resolve(root, 'src/shared') }
  },
  css: {
    postcss: {
      plugins: [tailwindcss({ config: resolve(root, 'tailwind.config.cjs') }), autoprefixer()]
    }
  },
  build: {
    outDir: resolve(root, 'out/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    chunkSizeWarningLimit: 1500
  },
  server: { port: 5173, strictPort: true }
})
