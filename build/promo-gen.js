// Renders promo PNGs of Drippy's states for the landing page.
// Run with: npx electron build/promo-gen.js
// Output: promo/drippy-<state>.png (1024x1024, transparent background)
//
// Drawn at native large size (no transform scaling) and glows are radial
// gradients, because scaled box-shadows band badly over transparency.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// creature at ~9x: 504x468 blob
const W = 504;
const H = 468;

const page = (halo, body, eyes, extra = '') => `<!DOCTYPE html><html><body style="margin:0;background:transparent">
<div style="position:relative;width:1024px;height:1024px">
  ${halo}
  <div style="position:absolute;left:${(1024 - W) / 2}px;bottom:120px;width:${W}px;height:${H}px">
    <div style="position:absolute;left:${W * 0.11}px;bottom:-70px;width:${W * 0.78}px;height:60px;border-radius:50%;background:rgba(0,0,0,.35);filter:blur(30px)"></div>
    ${extra}
    <div style="position:relative;width:${W}px;height:${H}px;${body}">${eyes}</div>
  </div>
</div></body></html>`;

const halo = (rgb, alpha) =>
  `<div style="position:absolute;left:50%;top:50%;width:1000px;height:1000px;transform:translate(-50%,-54%);` +
  `background:radial-gradient(closest-side, rgba(${rgb},${alpha}) 30%, rgba(${rgb},${alpha * 0.55}) 46%, rgba(${rgb},0) 68%)"></div>`;

const tealBody = (rotate = '') =>
  `border-radius:47% 53% 55% 45%/55% 49% 51% 45%;` +
  `background:linear-gradient(165deg,oklch(0.85 0.09 195),oklch(0.66 0.11 210));` +
  `box-shadow:inset 0 -72px 126px rgba(0,60,70,.35),inset 0 27px 54px rgba(255,255,255,.45);${rotate}`;

const violetBody =
  `border-radius:50% 50% 52% 48%/52% 52% 48% 48%;` +
  `background:linear-gradient(165deg,oklch(0.8 0.08 300),oklch(0.62 0.1 310));` +
  `box-shadow:inset 0 -72px 126px rgba(50,20,80,.35),inset 0 27px 54px rgba(255,255,255,.4);transform:rotate(5deg);`;

const eyes = (w, h, r, color, gap, top, shift) =>
  `<div style="position:absolute;left:0;right:0;top:${top}px;display:flex;justify-content:center;gap:${gap}px;transform:translateX(${shift}px)">
     <div style="width:${w}px;height:${h}px;border-radius:${r}px;background:${color}"></div>
     <div style="width:${w}px;height:${h}px;border-radius:${r}px;background:${color}"></div>
   </div>`;

const ring = `<div style="position:absolute;left:50%;top:50%;width:${W * 1.14}px;height:${W * 1.14}px;margin:-${(W * 1.14) / 2}px 0 0 -${(W * 1.14) / 2}px;border-radius:50%;
  background:conic-gradient(from -90deg,oklch(0.78 0.14 155 / .9) 0 128deg,transparent 128deg 140deg,oklch(0.82 0.13 85 / .9) 140deg 238deg,transparent 238deg 250deg,oklch(0.72 0.12 300 / .9) 250deg 348deg,transparent 348deg 360deg);
  -webkit-mask:radial-gradient(closest-side,transparent 84%,#000 86%)"></div>`;

const EYE = { w: 54, h: 90, r: 27, gap: 81, top: 144 };
const WIDE = { w: 72, h: 117, r: 36, gap: 72, top: 135 };

const STATES = {
  resting: page('', tealBody(), ''),
  active: page(halo('103,232,249', 0.34), tealBody(), eyes(EYE.w, EYE.h, EYE.r, '#0b2530', EYE.gap, EYE.top, 0)),
  working: page(
    halo('103,232,249', 0.34),
    tealBody('transform:rotate(5deg);'),
    eyes(EYE.w, EYE.h, EYE.r, '#0b2530', EYE.gap, EYE.top, -36)
  ),
  warning: page(
    halo('176,147,229', 0.36),
    violetBody,
    eyes(WIDE.w, WIDE.h, WIDE.r, '#1c0b30', WIDE.gap, WIDE.top, -36)
  ),
  footprint: page(
    '',
    `transform:scale(.785);filter:brightness(.9);border-radius:47% 53% 55% 45%/55% 49% 51% 45%;` +
      `background:linear-gradient(165deg,oklch(0.78 0.07 200),oklch(0.6 0.09 212));` +
      `box-shadow:inset 0 -54px 90px rgba(0,60,70,.4),inset 0 18px 45px rgba(255,255,255,.35);`,
    '',
    ring
  ),
};

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, '..', 'promo');
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  for (const [name, html] of Object.entries(STATES)) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `drippy-${name}.png`), img.toPNG());
    console.log(`wrote drippy-${name}.png`);
  }
  app.quit();
});
