const dock = document.getElementById('dock');
const capsule = document.getElementById('capsule');

// No-op bridge when opened in a plain browser (design preview / dev).
if (!window.drippy) {
  window.drippy = {
    onUpdate: () => {}, dragStart: () => {}, dragEnd: () => {}, click: () => {}, hover: () => {}, hit: () => {},
  };
}

// ---------------------------------------------------------------------------
// State: ambient (capsule) | privacyEvent. Glow overlays either. The daily
// numbers ride along so the expanded bar can show them live.
// ---------------------------------------------------------------------------

function fmtStats(s) {
  if (!s) return;
  const wh = s.wh || 0;
  document.getElementById('sEnergy').textContent = `${wh < 10 ? wh.toFixed(1) : Math.round(wh)} Wh`;
  document.getElementById('sWater').textContent = `${Math.round(s.waterMl || 0)} mL`;
  // Spend is measured (Claude Code) only; before any exact usage, show the
  // request count instead of a misleading $0.00.
  document.getElementById('sSpend').textContent =
    s.usd > 0 ? `$${s.usd.toFixed(2)}` : `${s.requests || 0} req`;
}

function applyState({ mode, glow, privacyLevel, stats }) {
  document.body.classList.toggle('mode-privacyEvent', mode === 'privacyEvent');
  document.body.classList.toggle('mode-ambient', mode !== 'privacyEvent');
  document.body.classList.toggle('has-glow', !!glow);
  document.body.classList.toggle('privacy-critical', privacyLevel === 1);
  document.body.classList.toggle('privacy-caution', privacyLevel === 2);
  fmtStats(stats);
}

// ---------------------------------------------------------------------------
// Click-through: the window ignores the mouse except over the capsule. Main
// forwards mouse moves while ignoring; we hit-test against the capsule's
// current rendered bounds (so the interactive area grows as it expands).
// ---------------------------------------------------------------------------

const HIT_PAD = 6;
let overDrippy = false;
let dragging = false;

function hitTest(x, y) {
  const r = capsule.getBoundingClientRect();
  return x >= r.left - HIT_PAD && x <= r.right + HIT_PAD && y >= r.top - HIT_PAD && y <= r.bottom + HIT_PAD;
}

function setOver(over) {
  if (over === overDrippy) return;
  overDrippy = over;
  document.body.classList.toggle('hovered', over);
  window.drippy.hit(over); // main toggles setIgnoreMouseEvents
  window.drippy.hover(over); // main shows the warning card during a warning
}

document.addEventListener('mousemove', (e) => {
  if (dragging) return;
  setOver(hitTest(e.clientX, e.clientY));
});
document.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget && !dragging) setOver(false);
});

// ---------------------------------------------------------------------------
// Drag (window moved by main via cursor polling) + click detection
// ---------------------------------------------------------------------------

let downAt = null;

dock.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !overDrippy) return;
  downAt = { x: e.screenX, y: e.screenY };
  dragging = true;
  document.body.classList.add('grabbed');
  dock.classList.add('dragging');
  window.drippy.dragStart();
});

window.addEventListener('mouseup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y);
  downAt = null;
  dragging = false;
  document.body.classList.remove('grabbed');
  dock.classList.remove('dragging');
  window.drippy.dragEnd();
  if (moved < 4) window.drippy.click();
  setOver(hitTest(e.clientX, e.clientY));
});

window.drippy.onUpdate(applyState);
