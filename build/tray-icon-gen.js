// Renders Drippy's menu-bar icons as monochrome macOS template images using
// Drippy's EXACT branding: the real CSS blob border-radius and the exact eye
// geometry, not an approximation. Two variants:
//   trayTemplate       normal eyes (6x10 r3, gap 9) - keeping an eye on things
//   trayAlertTemplate  wide eyes (8x13 r4, gap 8)   - privacy warning
// Template images are pure black + alpha; macOS tints them for the light/dark
// menu bar automatically.
//
// Method: render the true CSS blob (div with the exact border-radius) as a
// black silhouette, then punch the eyes out as transparency at their exact
// coordinates via canvas destination-out. Rendered at high resolution and
// downscaled for crisp anti-aliasing.
//
// Run with: npx electron build/tray-icon-gen.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// Exact brand values (from renderer/drippy.css).
const BLOB_W = 56;
const BLOB_H = 52;
const RADIUS = '47% 53% 55% 45% / 55% 49% 51% 45%';
// dx shifts both eyes sideways: Drippy's recognisable "glancing over" pose.
const VARIANTS = {
  trayTemplate: { w: 6, h: 10, r: 3, gap: 9, top: 16, dx: -4 }, // glancing over (signature)
  trayAlertTemplate: { w: 10, h: 15, r: 5, gap: 8, top: 14, dx: 0 }, // wide, facing forward
};
const F = 8; // supersample factor for smooth edges

const W = BLOB_W * F;
const H = BLOB_H * F;

const html = `<!DOCTYPE html><html><body style="margin:0;background:transparent">
  <div id="blob" style="width:${W}px;height:${H}px;border-radius:${RADIUS};background:#000"></div>
</body></html>`;

// Punch the two eyes out of the captured silhouette at exact scaled coords.
function cutEyes(pngBuffer, eye) {
  return `(() => {
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = ${W}; c.height = ${H};
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, ${W}, ${H});
        g.globalCompositeOperation = 'destination-out';
        const totalW = ${eye.w * 2 + eye.gap};
        const x0 = (${BLOB_W} - totalW) / 2 + ${eye.dx || 0};
        const eyes = [x0, x0 + ${eye.w + eye.gap}];
        for (const ex of eyes) {
          g.beginPath();
          g.roundRect(ex * ${F}, ${eye.top * F}, ${eye.w * F}, ${eye.h * F}, ${eye.r * F});
          g.fill();
        }
        resolve(c.toDataURL('image/png'));
      };
      img.src = 'data:image/png;base64,${pngBuffer.toString('base64')}';
    });
  })()`;
}

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: W,
    height: H,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, deviceScaleFactor: 1 },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const silhouette = (await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H })).toPNG();

  const h1 = 18;
  const w1 = Math.round((h1 * BLOB_W) / BLOB_H);
  for (const [name, eye] of Object.entries(VARIANTS)) {
    const dataUrl = await win.webContents.executeJavaScript(cutEyes(silhouette, eye));
    const full = nativeImage.createFromDataURL(dataUrl);
    fs.writeFileSync(path.join(outDir, `${name}.png`), full.resize({ width: w1, height: h1, quality: 'best' }).toPNG());
    fs.writeFileSync(path.join(outDir, `${name}@2x.png`), full.resize({ width: w1 * 2, height: h1 * 2, quality: 'best' }).toPNG());
    fs.writeFileSync(path.join(__dirname, `${name}-proof.png`), full.resize({ width: BLOB_W * 3, height: BLOB_H * 3, quality: 'best' }).toPNG());
    console.log(`wrote assets/${name}.png (${w1}x${h1}) + @2x`);
  }
  app.quit();
});
