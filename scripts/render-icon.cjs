// Renders build/logo.svg to PNGs with Chromium (run through Electron by scripts/make-icon.mjs).
// Outputs: build/icon.png (512, installer + exe), resources/icon.png (256, window), resources/tray.png (32, tray).
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '..')
const SIZE = 512
const svg = fs.readFileSync(path.join(root, 'build', 'logo.svg'), 'utf8')
const targets = [
  [512, path.join(root, 'build', 'icon.png')],
  [256, path.join(root, 'resources', 'icon.png')],
  [32, path.join(root, 'resources', 'tray.png')]
]

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      show: false,
      transparent: true,
      frame: false,
      backgroundColor: '#00000000',
      useContentSize: true,
      webPreferences: { offscreen: true }
    })
    const tmp = path.join(os.tmpdir(), 'zenith-icon.html')
    const sized = svg.replace('<svg ', `<svg style="display:block;width:${SIZE}px;height:${SIZE}px" `)
    fs.writeFileSync(tmp, `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${sized}</body></html>`)
    await win.loadFile(tmp)
    await new Promise((r) => setTimeout(r, 400))
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
    for (const [size, out] of targets) {
      fs.mkdirSync(path.dirname(out), { recursive: true })
      const scaled = size === SIZE ? img : img.resize({ width: size, height: size, quality: 'best' })
      fs.writeFileSync(out, scaled.toPNG())
      console.log(`wrote ${path.relative(root, out)} (${size}px)`)
    }
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
