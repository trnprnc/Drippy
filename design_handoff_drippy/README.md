# Handoff: Drippy — AI Transparency Companion

## Overview
Drippy is a small, always-on-top macOS desktop companion that makes the hidden impacts of AI usage visible: environmental impact, privacy awareness, and AI usage intelligence. It is pro-transparent-AI, not anti-AI. This handoff covers the **companion creature itself** — its form, states, and motion. Dashboard/detail views are not yet designed.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to ship. The task is to **recreate this design in the target codebase's environment**. For a macOS always-on-top companion the natural fits are:
- **Swift/SwiftUI** with a borderless, transparent, floating `NSWindow` (`.level = .floating`, `isOpaque = false`, click-through where appropriate), or
- **Electron/Tauri** with a transparent frameless always-on-top window.

If no environment exists yet, choose one of the above. The CSS in the reference files translates directly to Core Animation / SwiftUI or stays as CSS in Electron.

## Fidelity
**High-fidelity.** Colors, sizes, radii, shadows, and motion timings below are final intent. Recreate faithfully, adapting units to the platform.

## The Character — chosen direction: "Blink" (option 1e)
Drippy is an organic teal blob, 56×52 px at true size, that floats above the desktop.

**Core rule — "rule of the face":** at rest Drippy has **no eyes** — it is an anonymous floating blob. Eyes exist **only while Drippy has something to show you** (AI running, privacy event). Silence is the default; color and posture communicate first; words appear only on click (click behavior not yet designed).

### Blob construction
- Size: 56 × 52 px (resting). Draggable anywhere; always-on-top.
- Shape: organic blob via animated border-radius morph between
  `47% 53% 55% 45% / 55% 49% 51% 45%` and `53% 47% 45% 55% / 47% 55% 45% 53%`.
- Fill: linear-gradient 165°, from `oklch(0.85 0.09 195)` (light aqua, top-left) to `oklch(0.66 0.11 210)` (deep teal, bottom-right).
- Inner shading: inset shadow `0 -8px 14px rgba(0,60,70,.35)` (bottom depth) + inset highlight `0 3px 6px rgba(255,255,255,.45)` (top sheen).
- Drop shadow onto desktop: `0 10px 20px rgba(0,0,0,.45)`, plus a soft elliptical ground shadow beneath (44×8 px, `rgba(0,0,0,.5)`, blur 4px) that scales with the bob.

### States

**1. RESTING (default)**
- Eyeless blob.
- Motion: vertical bob ±4 px, 5 s ease-in-out loop; border-radius morph 7 s ease-in-out alternate; ground shadow scaleX 1→0.82 in sync with bob.
- No glow, no signal.

**2. AI ACTIVE (eyes open)**
- Trigger: an AI request is running (any monitored app/API).
- Eyes appear: two rounded rectangles 6×10 px, radius 3 px, color `#0b2530`, 9 px gap, positioned ~16 px from top, offset toward the active window (lean: body rotates −5°, eyes translate 4 px toward work).
- Blink: scaleY 1→0.12→1 at ~91–97% of a 6 s loop.
- Glow: outer shadow `0 0 16px rgba(103,232,249,.3)` (cyan).
- Motion: morph speeds up to 4 s.

**3. PRIVACY EVENT (wide-eyed)**
- Trigger: personal data leaves the machine (clipboard/file/prompt containing detected PII sent to a remote model).
- Body turns violet: gradient `oklch(0.8 0.08 300)` → `oklch(0.62 0.1 310)`; shape rounds up (near-circle: `50% 50% 52% 48% / 52% 52% 48% 48%`).
- Eyes wide: 8×13 px, radius 4 px, color `#1c0b30`, 8 px gap.
- Glow: `0 0 18px oklch(0.72 0.12 300 / .45)`; whole body pulses opacity 1→0.4, 1.6 s loop.
- Inner shading shifts violet: inset `0 -8px 14px rgba(50,20,80,.35)`.
- Click reveals details (future work).

**4. DAY'S FOOTPRINT (end of day)**
- Blob dims (brightness ~0.9, desaturated teal `oklch(0.78 0.07 200)` → `oklch(0.6 0.09 212)`), shrinks to ~44×41 px, eyeless.
- A ring (64 px, stroke ~5 px, i.e. donut mask from 84% radius) surrounds it, divided into three arcs with small gaps (~12° each):
  - Environment: `oklch(0.78 0.14 155)` (green), arc proportional to share
  - Usage/energy: `oklch(0.82 0.13 85)` (amber)
  - Privacy events: `oklch(0.72 0.12 300)` (violet)

### Signal color palette (shared vocabulary)
- AI activity: `oklch(0.82 0.12 195)` / cyan glow `rgba(103,232,249,…)`
- Environment: `oklch(0.78 0.14 155)`
- Usage / energy: `oklch(0.82 0.13 85)`
- Privacy: `oklch(0.72 0.12 300)`
- Alert (reserved, unused so far): `oklch(0.72 0.15 30)`

## Interactions & Behavior
- **Always-on-top, draggable.** Position persists across launches.
- **Drag:** blob should squish (scale 1.1x/0.9y on grab, spring back on release) — designed intent, not in the HTML reference.
- **State transitions:** cross-fade color/shape over ~400 ms ease-out; eyes fade+scale in over ~250 ms.
- **Silent by default:** no sounds, no notifications, no text. Words only on click (future).
- **Hover:** none designed yet; keep none or a subtle 1.03 scale.

## State Management
- `mode`: `resting | aiActive | privacyEvent | footprint` — driven by an activity monitor.
- `aiActive` while ≥1 monitored AI request is in flight; return to `resting` ~2 s after last request completes.
- `privacyEvent` overrides `aiActive` for its duration (min ~4 s or until acknowledged).
- `footprint` shown on user request or at a configured end-of-day time.
- Daily accumulators: environment share, energy share, privacy-event count → arc lengths in footprint ring.

## Design Tokens
- True size: 56×52 px (resting), 44×41 px (footprint)
- Eye sizes: 6×10 r3 (active), 8×13 r4 (privacy); gaps 9 px / 8 px
- Timings: bob 5 s, morph 7 s (rest) / 4 s (active), blink loop 6 s, pulse 1.6 s, transitions 250–400 ms
- Fonts (spec pages only, not the character): Bricolage Grotesque for headings, system UI monospace for labels — the character itself renders no text.

## Assets
None — the character is drawn entirely with gradients, border-radius, and shadows. No images or SVGs required.

## Files
- `Drippy Final.dc.html` — final spec: resting hero on a desktop mock + all four states with notes. **Primary reference.**
- `Drippy Explorations.dc.html` — earlier exploration (5 directions); chosen direction is card 1e "Blink". Context only.
- `support.js` — runtime that lets the `.dc.html` files open directly in a browser. Not part of the design.

Open the `.dc.html` files in a browser (with `support.js` alongside) to see live motion.
