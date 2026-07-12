const stage = document.getElementById('stage');
const ring = document.getElementById('ring');

const MODES = ['resting', 'privacyEvent', 'footprint'];

// Signal vocabulary: eyes = about you, gaze = looking toward your work,
// glow = AI energy flowing on this machine, lean = your request
// specifically. Privacy/footprint remain whole-body modes.
function applyState({ mode, eyes, gaze, glow, lean, leanDir, arcs }) {
  for (const m of MODES) document.body.classList.toggle(`mode-${m}`, m === mode);
  document.body.classList.toggle('has-eyes', !!eyes);
  document.body.classList.toggle('has-gaze', !!gaze);
  document.body.classList.toggle('has-glow', !!glow);
  document.body.classList.toggle('has-lean', !!lean);

  // Lean: body rotates 5° and eyes shift 4px toward the work
  // (leanDir = 1 means the work is to Drippy's right; spec card shows
  // rotate(-5deg) + translateX(4px), mirrored for the other side).
  document.body.style.setProperty('--lean-rot', `${leanDir === -1 ? 5 : -5}deg`);
  document.body.style.setProperty('--lean-x', `${leanDir === -1 ? -4 : 4}px`);

  if (arcs) setRing(arcs);
}

// Three arcs with ~12° gaps: green environment, amber usage/energy, violet privacy.
function setRing({ env, energy, privacy }) {
  const GAP = 12;
  const avail = 360 - GAP * 3;
  const a1 = env * avail;
  const a2 = energy * avail;
  const a3 = privacy * avail;
  let d = 0;
  const stops = [];
  const seg = (color, len) => {
    stops.push(`${color} ${d}deg ${d + len}deg`);
    d += len;
    stops.push(`transparent ${d}deg ${d + GAP}deg`);
    d += GAP;
  };
  seg('oklch(0.78 0.14 155 / .9)', a1);
  seg('oklch(0.82 0.13 85 / .9)', a2);
  seg('oklch(0.72 0.12 300 / .9)', a3);
  ring.style.background = `conic-gradient(from -90deg, ${stops.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Drag (window moved by main process via cursor polling) + click detection
// ---------------------------------------------------------------------------

// No-op bridge when opened in a plain browser (design preview / dev).
if (!window.drippy) {
  window.drippy = { onUpdate: () => {}, dragStart: () => {}, dragEnd: () => {}, click: () => {} };
}

let downAt = null;

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  downAt = { x: e.screenX, y: e.screenY };
  document.body.classList.add('grabbed');
  stage.classList.add('dragging');
  window.drippy.dragStart();
});

window.addEventListener('mouseup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y);
  downAt = null;
  document.body.classList.remove('grabbed');
  stage.classList.remove('dragging');
  window.drippy.dragEnd();
  if (moved < 4) window.drippy.click();
});

window.drippy.onUpdate(applyState);
