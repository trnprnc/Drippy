// Renders Drippy's menu-bar icon as a monochrome macOS template image using
// Drippy's EXACT branding: the real CSS blob border-radius and the exact eye
// geometry, not an approximation. Template images are pure black + alpha;
// macOS tints them for the light/dark menu bar automatically.
//
// Method: render the true CSS blob (div with the exact border-radius) as a
// black silhouette, then punch the two eyes out as transparency at their
// exact coordinates via canvas destination-out. Rendered at high resolution
// and downscaled for crisp anti-aliasing.
//
// Run with: npx electron build/tray-icon-gen.js
// Output: assets/trayTemplate.png (1x) and assets/trayTemplate@2x.png (2x)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// Exact brand values (from renderer/drippy.css, resting/active geometry).
const BLOB_W = 56;
const BLOB_H = 52;
const RADIUS = '47% 53% 55% 45% / 55% 49% 51% 45%';
const EYE = { w: 6, h: 10, r: 3, gap: 9, top: 16 };
const F = 8; // supersample factor for smooth edges

const W = BLOB_W * F;
const H = BLOB_H * F;

const html = `<!DOCTYPE html><html><body style="margin:0;background:transparent">
  <div id="blob" style="width:${W}px;height:${H}px;border-radius:${RADIUS};background:#000"></div>
</body></html>`;

// Punch the two eyes out of the captured silhouette, at exact scaled coords.
function cutEyes(pngBuffer) {
  return `(() => {
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = ${W}; c.height = ${H};
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, ${W}, ${H});
        g.globalCompositeOperation = 'destination-out';
        const totalW = ${EYE.w * 2 + EYE.gap};
        const x0 = (${BLOB_W} - totalW) / 2;
        const eyes = [x0, x0 + ${EYE.w + EYE.gap}];
        for (const ex of eyes) {
          const x = ex * ${F}, y = ${EYE.top * F}, w = ${EYE.w * F}, h = ${EYE.h * F}, r = ${EYE.r * F};
          g.beginPath();
          g.roundRect(x, y, w, h, r);
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
    width: BLOB_W * F,
    height: BLOB_H * F,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, deviceScaleFactor: 1 },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));

  const silhouette = (await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H })).toPNG();
  const dataUrl = await win.webContents.executeJavaScript(cutEyes(silhouette));
  const full = nativeImage.createFromDataURL(dataUrl);

  // Downscale to menu-bar sizes (height ~18pt), preserving 56:52 aspect.
  const h1 = 18;
  const w1 = Math.round((h1 * BLOB_W) / BLOB_H);
  const at1x = full.resize({ width: w1, height: h1, quality: 'best' });
  const at2x = full.resize({ width: w1 * 2, height: h1 * 2, quality: 'best' });
  fs.writeFileSync(path.join(outDir, 'trayTemplate.png'), at1x.toPNG());
  fs.writeFileSync(path.join(outDir, 'trayTemplate@2x.png'), at2x.toPNG());
  // A larger proof for visual review.
  fs.writeFileSync(path.join(__dirname, 'trayTemplate-proof.png'), full.resize({ width: BLOB_W * 3, height: BLOB_H * 3, quality: 'best' }).toPNG());
  console.log(`wrote assets/trayTemplate.png (${w1}x${h1}) and @2x (${w1 * 2}x${h1 * 2})`);
  app.quit();
});
