# Changelog

## 0.6.1 (2026-07-14)

- **Warning bubble no longer clips.** The attention bubble was a fixed height,
  so longer recommendations (and the action button) were cut off. It now sizes
  to its content.
- **Notification nudge.** During a privacy warning a small alert badge appears
  at the blob's top-right, a recognisable "there's something to see here" cue
  that invites you to hover for the details.

## 0.6.0 (2026-07-14)

- **Clipboard privacy now matches real workflows.** Previously Drippy only
  scanned the clipboard while Claude was the frontmost app, so a secret
  copied from a browser, a .env file or a password manager (the normal way
  people do it) was missed at copy time. Drippy now watches the clipboard
  throughout an active Claude session, frontmost or within ~3 minutes of
  using Claude, and warns the instant a secret is detected, so you're caught
  before you paste it in. The menu-bar eyes go wide even while you're still in
  the other app. Scanning stops once you have not used Claude for a few
  minutes; it never scans your clipboard outside a Claude session. Docs
  updated to describe this plainly.

## 0.5.6 (2026-07-14)

- **Menu-bar icon refined for recognisability and a clearer alert.** The
  resting icon now shows Drippy's signature "glancing over" pose (eyes
  offset to the side). During a privacy warning the eyes go wide *and face
  forward*, and are a touch larger, so the shift from calm-glance to
  wide-forward is obvious at a glance in the top bar.

## 0.5.5 (2026-07-14)

- **The menu bar reacts too.** During a privacy warning, Drippy's menu-bar
  eyes go wide and return to normal when the warning clears, extending the
  "eyes open when there's something to show you" rule to the menu bar. Same
  monochrome template style; verified end to end.

## 0.5.4 (2026-07-14)

- **Professional menu-bar icon.** Replaced the colour 💧 emoji with a
  monochrome macOS template icon that macOS tints for the light/dark menu
  bar, in line with other menu-bar apps. The mark is Drippy's exact blob
  (the real CSS border-radius) with the precise eye geometry cut out: eyes
  as the symbol of keeping an eye on things. Generated from the true brand
  shape by `build/tray-icon-gen.js`, not an approximation.

## 0.5.3 (2026-07-14)

- **Cache-read energy factor corroborated.** The dominant term for agentic
  workloads (0.005) is now backed by two independent lines rather than the
  price proxy alone: Anthropic's cache-read price (0.1× input) and a measured
  85–95% energy saving on a cache hit (a cache-read token costs 5–15% of a
  fresh input token, i.e. 0.0025–0.0075× an output token; we use the 0.005
  mid). The per-cached-token structure matches how the saving is measured.
  Sources added to the registry; a direct energy measurement stays on the
  watch list.
- **Water "what counts as used" simplified**: water evaporated (taken out of
  the local water cycle) is counted as used; water drawn and returned is
  deferred. Documented plainly; the model (consumptive, onsite + offsite) is
  unchanged.

## 0.5.2 (2026-07-14)

- **Water modelled properly: onsite + offsite.** Previously Drippy counted
  only onsite cooling water (WUE 1.1 mL/Wh). It now adds the water used to
  generate the electricity (US thermoelectric consumptive ~1.25 mL/Wh, EIA),
  which is comparable or larger, for a total ~2.35 mL/Wh. Uses consumptive
  (evaporated) water, the honest metric, not the larger withdrawal figures.
  Water will still only be shown at meaningful scale, once confident.
- **Living sources registry** (`impact-sources.json`): every factor's
  evidence with URLs, figures, dates, and the better source we're still
  chasing. This is the document we track the web against; reviewed monthly
  and whenever new provider/study data lands.

## 0.5.1 (2026-07-14)

- **Energy factors regrounded in current (2026) measurements.** Replaced the
  triangulated-from-2025 figures with values anchored to 2026 inference-energy
  research, each factor carrying a dated source in `impact-factors.json`:
  per-output-token energy range, the ≤3.4% prefill / ≥96% decode split (input
  ratio 0.1 → 0.05), cache-read energy at the price-ratio proxy (0.005),
  model tiers spanning the measured per-token range (Opus 2.5 → 2.0, Haiku
  0.3 → 0.25), and US regional grid carbon (350 → 321 gCO₂e/kWh, since Claude
  runs in US regions). METHODOLOGY updated with citations, and cache-read
  energy flagged as the dominant term and top measurement priority.

## 0.5.0 (2026-07-14)

- **Exact token accounting for Claude Code.** Drippy now reads the provider
  `usage` numbers Claude Code writes to its own local session transcripts:
  real input, output and the exact prompt-cache split, per message, live. For
  the heaviest workload on a developer's machine there is no longer any token
  estimation. It reads only the usage numbers and model id, never the message
  content. A measured session showed 94% of input tokens were cache reads, so
  a fixed "fresh fraction" guess was replaced with the true per-message split.
- **Model-tier energy multipliers.** Larger models cost more energy per token;
  Claude Code exposes the model per message, so Opus, Sonnet, Haiku and others
  are now priced differently (provisional multipliers, to be replaced with
  measured figures from open inference-energy work).
- **Cache-read energy factor** added: cache reads cost far less than fresh
  processing, and are now priced as such rather than lumped into input.
- Simulation and Demo controls are no longer present in the shipped build
  (development only). Removed Drippy's own CPU readout from the menu for now.

## 0.4.0 (2026-07-12)

- **Privacy concerns catalogue**: 21 concerns across three severities, built
  for people building with Claude Code who may not know the dangers:
  credentials & secrets (Anthropic/OpenAI/GitHub/AWS/Stripe/Slack/Google
  keys, private key files, database connection strings, JWTs, bearer
  tokens, .env-style password lines), financial and government identity
  (cards, IBAN, UK bank details, NI numbers, SSNs), and personal contact
  details (email, phone, date of birth). Each has a plain-English
  recommendation that explains the danger and the remedy (rotate the key,
  change the DB password, use a placeholder and so on).
- Attention bubble shows the most severe concern first; **critical**
  concerns use the design system's reserved alert color instead of violet.
- False-positive discipline: rules favour precision (Luhn checks, context
  keywords, URL-credential exclusion for emails), covered by a 33-case test
  suite including negative traps.

## 0.3.0 (2026-07-12)

- **Attention progression.** The face now tells a coherent story: eyes
  forward while AI is in use, eyes on the work (with a slight body tilt)
  while you're actively typing, and the warning keeps the eyes locked on
  the work, because that's where the problem is.
- **A glow you can actually see.** The AI-energy halo is much stronger and
  now breathes (2.2s pulse); peripheral vision catches motion, not static
  light. The privacy glow got the same treatment. Window enlarged slightly
  so the halo doesn't clip.
- **Hover for details on warnings.** During a warning, hovering Drippy opens
  an attention bubble beside it: what was spotted (category only, never the
  content), where it was, a recommendation, and an action when one exists
  ("Clear clipboard"). Warnings stay visible for 15s to give time to hover.

## 0.2.0 (2026-07-12)

- **Usage history and trends.** Drippy now remembers activity over time: local,
  append-only day records and per-event logs (app names, token/energy
  estimates, privacy categories; never content). Days survive restarts and
  midnight boundaries, including when Drippy was off at midnight.
- **Usage trends window** (💧 menu): 30-day charts for energy, requests, and
  privacy events with hover details, 7-day stat tiles, per-app breakdown, and
  a data table. Chart colors derive from Drippy's signal palette, tuned and
  validated per light/dark mode for contrast and color-vision safety.
- Privacy events now record category counts per day for trend analysis.
- Note: sharing any aggregate of this data (the future "community trends")
  will be strictly opt-in and is not implemented; history never leaves the
  device. See PRIVACY.md.

## 0.1.0 (2026-07-12)

First downloadable build (macOS, Apple Silicon).

- The companion: always-on-top blob per the "1e Blink" design: resting,
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
  Verdicts only, content is never stored, logged, or transmitted.
- Menu-bar item: live status, today's totals, Drippy's own CPU use, privacy
  history, simulate/demo tools, day's footprint toggle.
- First-run welcome window: signal vocabulary and the "what Drippy can see"
  disclosure.
- Launches at login when installed; logs to `~/Library/Logs/Drippy.log`.

Known gaps: claude.ai browser tabs are metadata-only (extension planned),
model tier not detected, unsigned build (see README install note), Apple
Silicon only.
