# Changelog

## 0.3.0 — 2026-07-12

- **Attention progression.** The face now tells a coherent story: eyes
  forward while AI is in use → eyes on the work (with a slight body tilt)
  while you're actively typing → the warning keeps the eyes locked on the
  work, because that's where the problem is.
- **A glow you can actually see.** The AI-energy halo is much stronger and
  now breathes (2.2s pulse) — peripheral vision catches motion, not static
  light. The privacy glow got the same treatment. Window enlarged slightly
  so the halo doesn't clip.
- **Hover for details on warnings.** During a warning, hovering Drippy opens
  an attention bubble beside it: what was spotted (category only — never the
  content), where it was, a recommendation, and an action when one exists
  ("Clear clipboard"). Warnings stay visible for 15s to give time to hover.

## 0.2.0 — 2026-07-12

- **Usage history & trends.** Drippy now remembers activity over time — local,
  append-only day records and per-event logs (app names, token/energy
  estimates, privacy categories; never content). Days survive restarts and
  midnight boundaries, including when Drippy was off at midnight.
- **Usage trends window** (💧 menu): 30-day charts for energy, requests, and
  privacy events with hover details, 7-day stat tiles, per-app breakdown, and
  a data table. Chart colors derive from Drippy's signal palette, tuned and
  validated per light/dark mode for contrast and color-vision safety.
- Privacy events now record category counts per day for trend analysis.
- Note: sharing any aggregate of this data (the future "community trends")
  will be strictly opt-in and is not implemented — history never leaves the
  device. See PRIVACY.md.

## 0.1.0 — 2026-07-12

First downloadable build (macOS, Apple Silicon).

- The companion: always-on-top blob per the "1e Blink" design — resting,
  attentive (eyes), gaze-toward-work, glow (AI energy), lean (your request),
  privacy (violet pulse), day's footprint ring. Draggable, position persists,
  squish-on-grab.
- Live sensing, Claude-on-Mac first: network flow monitor (Anthropic address
  block, IPv4+IPv6, adaptive hot/cold cadence), presence/typing engagement
  sensor, foreground/background request attribution.
- Impact engine: bytes → tokens (both directions) → Wh/CO₂e/water via
  versioned, cited factor table (v2026.07.2) with ±3× uncertainty band and a
  prompt-cache discount for agentic workloads. Daily accumulators persist
  across restarts and reset at midnight.
- Privacy guard: on-device PII rules (API keys, emails, phones, cards with
  Luhn check, UK NI numbers, IBANs, SSNs) over the clipboard (no permissions)
  and the Claude composer while typing (optional Accessibility grant).
  Verdicts only — content is never stored, logged, or transmitted.
- Menu-bar item: live status, today's totals, Drippy's own CPU use, privacy
  history, simulate/demo tools, day's footprint toggle.
- First-run welcome window: signal vocabulary and the "what Drippy can see"
  disclosure.
- Launches at login when installed; logs to `~/Library/Logs/Drippy.log`.

Known gaps: claude.ai browser tabs are metadata-only (extension planned),
model tier not detected, unsigned build (see README install note), Apple
Silicon only.
