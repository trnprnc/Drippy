// Renders the resting blob at icon size and writes build/icon-1024.png.
// Run with: npx electron build/icon-gen.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const HTML = `<!DOCTYPE html><html><body style="margin:0;background:transparent">
<div style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center">
  <div style="width:720px;height:668px;
    border-radius:47% 53% 55% 45%/55% 49% 51% 45%;
    background:linear-gradient(165deg,oklch(0.85 0.09 195),oklch(0.66 0.11 210));
    box-shadow:0 60px 120px rgba(0,0,0,.35),
      inset 0 -100px 180px rgba(0,60,70,.35),
      inset 0 40px 80px rgba(255,255,255,.45)"></div>
</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'icon-1024.png'), img.toPNG());
  console.log('icon written');
  app.quit();
});
