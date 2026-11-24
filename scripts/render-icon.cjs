/**
 * Renders resources/icon.svg → resources/icon.png (1024 px, transparent corners)
 * with Electron's offscreen renderer, so no image tooling is needed.
 * Usage: npm run gen:icon
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const [svgPath, outPath, size] = process.argv.slice(-3)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const s = Number(size)
  const w = new BrowserWindow({ width: s, height: s, show: false, transparent: true, frame: false, backgroundColor: '#00000000', webPreferences: { offscreen: true } })
  const svg = fs.readFileSync(svgPath, 'utf8')
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${s}" height="${s}"></body></html>`
  await w.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise(r => setTimeout(r, 400))
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: s, height: s })
  fs.writeFileSync(outPath, img.resize({ width: s, height: s }).toPNG())
  app.quit()
})
