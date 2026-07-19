const stage = document.getElementById('stage');
const ring = document.getElementById('ring');

const MODES = ['resting', 'privacyEvent', 'footprint'];

// The attention progression: eyes forward (AI in use) → eyes on the work
// (typing) → warning keeps eyes on the work. Glow = AI energy flowing.
function applyState({ mode, eyes, gaze, glow, leanDir, arcs, privacyLevel, dozing }) {
  // A warning or the footprint always interrupts a playful transform.
  if (mode === 'privacyEvent' || mode === 'footprint') clearShape();
  for (const m of MODES) document.body.classList.toggle(`mode-${m}`, m === mode);
  document.body.classList.toggle('has-eyes', !!eyes);
  document.body.classList.toggle('has-gaze', !!gaze);
  document.body.classList.toggle('has-glow', !!glow);
  document.body.classList.toggle('dozing', !!dozing);
  // Privacy tier: 1 = critical (wide eyes + badge), 2 = caution (squint).
  document.body.classList.toggle('privacy-critical', privacyLevel === 1);
  document.body.classList.toggle('privacy-caution', privacyLevel === 2);

  // Lean: body rotates 5° and eyes shift 4px toward the work
  // (leanDir = 1 means the work is to Drippy's right; spec card shows
  // rotate(-5deg) + translateX(4px), mirrored for the other side).
  document.body.style.setProperty('--lean-rot', `${leanDir === -1 ? 5 : -5}deg`);
  document.body.style.setProperty('--lean-x', `${leanDir === -1 ? -4 : 4}px`);

  if (arcs) setRing(arcs);
}

// Three arcs with ~12° gaps: green environment, amber usage/energy, violet privacy.
// Three pillar gauges: environment (green), AI usage (amber), privacy
// (violet). Each occupies a third of the ring and fills toward its daily
// reference, over a faint track. Hover Drippy in footprint mode for numbers.
function setRing({ usage, env, privacy }) {
  const GAP = 14;
  const span = (360 - GAP * 3) / 3; // per-pillar segment
  const track = 'oklch(0.72 0.03 250 / .16)';
  const parts = [];
  let d = 0;
  const gauge = (color, val) => {
    const fill = Math.max(0, Math.min(1, val || 0)) * span;
    if (fill > 0.5) parts.push(`${color} ${d}deg ${d + fill}deg`);
    if (fill < span - 0.5) parts.push(`${track} ${d + fill}deg ${d + span}deg`);
    d += span;
    parts.push(`transparent ${d}deg ${d + GAP}deg`);
    d += GAP;
  };
  gauge('oklch(0.78 0.14 155)', env); // green
  gauge('oklch(0.82 0.13 85)', usage); // amber
  gauge('oklch(0.72 0.12 300)', privacy); // violet
  ring.style.background = `conic-gradient(from -90deg, ${parts.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Drag (window moved by main process via cursor polling) + click detection
// ---------------------------------------------------------------------------

// No-op bridge when opened in a plain browser (design preview / dev).
if (!window.drippy) {
  window.drippy = {
    onUpdate: () => {}, dragStart: () => {}, dragEnd: () => {}, click: () => {}, hover: () => {}, onMorph: () => {},
  };
}

let downAt = null;

stage.addEventListener('mouseenter', () => window.drippy.hover(true));
stage.addEventListener('mouseleave', () => window.drippy.hover(false));

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  downAt = { x: e.screenX, y: e.screenY };
  document.body.classList.add('grabbed');
  stage.classList.add('dragging');
  window.drippy.dragStart();
});

// Shape-shifting with purpose. The bicycle rides in with a wellbeing nudge
// ("go take a break"); the magnifying glass appears when Drippy has looked
// closely at your writing (an authenticity nudge). Clicking Drippy also
// cycles them, as a bit of fun. Never during a warning or the footprint.
const SHAPES = ['bike', 'glass'];
let shapeIdx = 0;
let shapeTimer = null;

function clearShape() {
  clearTimeout(shapeTimer);
  document.body.classList.remove('shaped', 'shape-bike', 'shape-glass');
}

function morphTo(shape, holdMs = 2600) {
  const b = document.body;
  if (b.classList.contains('mode-privacyEvent') || b.classList.contains('mode-footprint')) return;
  b.classList.remove('shape-bike', 'shape-glass');
  b.classList.add('shaped', `shape-${shape}`);
  clearTimeout(shapeTimer);
  shapeTimer = setTimeout(clearShape, holdMs);
}

function tryTransform() {
  if (document.body.classList.contains('shaped')) {
    clearShape(); // click again to pop straight back
    return;
  }
  morphTo(SHAPES[shapeIdx++ % SHAPES.length]);
}

// A wellbeing suggestion turns Drippy into a bike; an authenticity one into
// a magnifying glass. Held a touch longer so it's clearly readable.
window.drippy.onMorph((shape) => morphTo(shape, 3400));

window.addEventListener('mouseup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y);
  downAt = null;
  document.body.classList.remove('grabbed');
  stage.classList.remove('dragging');
  window.drippy.dragEnd();
  if (moved < 4) {
    tryTransform();
    window.drippy.click();
  }
});

window.drippy.onUpdate(applyState);
