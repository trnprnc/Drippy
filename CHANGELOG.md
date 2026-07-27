# Changelog

## 2.2.0 (2026-07-27) — impact first

- **Complete usage history.** The Claude Code adapter was forward-only, so
  history was only ever as complete as Drippy's uptime. It now keeps a read
  cursor per transcript and backfills the full history on first run, deduped
  and bucketed to the day each message actually happened.
- **Steady presence.** The glow no longer flickers off between an agentic
  task's API calls; it holds until things have genuinely been quiet, then
  settles once and — if you are not watching Claude — tells you.
- **Usage trends rebuilt as a transparency dashboard.** Three pillars
  (energy, water, API-rate value) across today / this week / all time, a
  daily chart where any day opens its own breakdown, composition panels
  showing where the tokens and the energy go, a measured-vs-estimated split,
  and a derivation drawer on every figure: the formula, that range's real
  drivers, the factor values, their citations, and the uncertainty band.
- **Removed the typed-text privacy guard.** Reading the focused Claude
  composer through macOS Accessibility was the most invasive thing Drippy
  did, it cost every user a permission grant, and it put Drippy inside your
  messages as you wrote them. Drippy is the transparency layer for AI impact
  first, so that reach is no longer justified. **Drippy now requires no macOS
  permissions at all.** The clipboard guard is unchanged and still covers the
  paste path that carries almost every real secret.
- **Electron 31 → 43.** Apple revoked the notarization for Electron 31.7.7,
  so macOS refused to launch it ("contains malware"). Any build on the old
  runtime is affected, so this upgrade is required, not optional.

## 2.1.1 (2026-07-21) — read Claude's composer

- **The type-as-you-go privacy scan now actually works against Claude.**
  Claude is a Chromium/Electron app that does not expose its web-based
  composer to macOS Accessibility by default, so `AXFocusedUIElement`
  failed and the typed-text scan silently read nothing (the clipboard
  guard was unaffected). Drippy now sets `AXManualAccessibility` on the
  Claude process to force Chromium to build its accessibility tree,
  after which the composer is a readable text field. This restores
  catching sensitive data at the point of entry, before Send.

## 2.1.0 (2026-07-21) — menu-bar pill and cloud sync

- **Drippy is now the menu-bar pill, full stop.** A small dark pill living
  in the menu bar strip, the Mac cousin of the iPhone island widget. A teal
  shimmer sweeps through it while AI is at work, violet means a privacy
  caution, and it swells below the bar with a badge for a critical warning.
  Hover opens today's numbers, each pillar wearing its colour dot; click
  opens usage trends. It slides along the bar when dragged and, on notched
  Macs, starts just to the right of the notch. The corner capsule and the
  separate menu bar icon (tray) are gone: right-click on the pill now holds
  everything the tray held (trends, notices, the welcome sheet, the tour,
  reset, quit).
- **Usage trends, sharpened.** 7-day tiles for energy, water, requests,
  privacy events and measured spend; a 7-day line with everyday
  equivalents; a fuller data table (requests, tokens in/out, Wh, mL,
  g CO₂e, privacy, measured spend per day); and a plain provenance note
  stating which numbers are measured, which are estimated, and how wide
  the estimate band is.
- **Language pass.** Nothing instructs or judges: the critical pill says
  "Sensitive data" and trusts the hover, the stats card footer dropped
  "click me", and notices state what the meters show without editorialising
  ("A heavier AI day than most" rather than "Fine if it earned its keep").
- **Right-click menu slimmed to essentials.** Usage trends, What Drippy can
  see, Reset day, Quit. Notices and Replay the tour left the menu; all
  simulation and demo-mode machinery was deleted outright.
- **Tour tightened.** Nothing that states the obvious, nothing negative,
  nothing OS-specific: four short cards on what Drippy tracks, the glow,
  the privacy warning and the three interactions.
- **Local-storage claims removed** from the app and docs (trends header,
  welcome sheet, README, USER-GUIDE, PRIVACY) ahead of commercial data
  storage design.
- **Sync, off by default (Phase 1 of DATA-STORAGE.md).** An opt-in in the
  welcome sheet enrols this device into a personal workspace and batches
  local history (drivers and verdicts, in whitelisted shapes) to the
  ingest service hourly and at day close. Every batch is written to an
  append-only upload ledger before it is sent and its outcome after,
  shown in the welcome sheet as "What has been shared". The ingest
  service (server/) runs on a memory store for development and Neon
  Postgres for production; records are rebuilt through whitelists at the
  door, so no field that could hold content survives on either side.
- **Ingest hosting, codified for Fly.io (London).** server/Dockerfile,
  fly.toml and DEPLOY.md deploy the service off-device so sync survives a
  Mac restart. The public endpoint is hardened: graceful shutdown drains
  in-flight batches on redeploy, and an optional ENROLL_TOKEN gates
  enrolment against abuse (the device sends it via DRIPPY_ENROLL_TOKEN).

## 2.0.0 (2026-07-20) — the transparency layer

Drippy optimises for one purpose now: making the true cost of your AI use
visible. Clean and precise; everything that did not serve that purpose has
been removed (Jack's steer, 2026-07-20).

- **Always present, never in the way.** The blob is gone. Drippy lives as a
  small still droplet, and the window is genuinely click-through except over
  the droplet itself: clicks land on whatever is beneath. He swells to full
  size for exactly one thing, a critical privacy warning. Glow = AI energy
  flowing; violet = privacy caution. That is the entire visual language.
- **Hover = today's numbers.** Energy, water, carbon, requests, privacy
  events and measured spend, always one hover away. Click = 30-day trends.
  The footprint ring and its mode are gone; the numbers moved to where your
  cursor already is.
- **New measure: spend.** Exact Claude Code token counts are priced at
  Anthropic's current list rates (cache-aware) and shown as "$x.xx at API
  rates (measured)". Estimated traffic is never priced; no false precision.
- **New measure: everyday equivalents.** Wh, mL and gCO₂e are translated
  into phone charges, glasses of water and petrol-car kilometres, in the
  hover card and the menu bar. Factors are cited in impact-factors.json.
- **Removed:** the writing-style detector (aitell) and authenticity nudges,
  prompt-craft and wellbeing coaching, the break timer, the bicycle and
  magnifying-glass morphs, the doze animation and the footprint ring.
  Suggestions became **notices**: transparency-grounded observations only
  (usage, guard, onboarding), each stating why it fired, with a button that
  does the thing.
- The tour is now four cards; welcome sheet, guide and site rewritten to
  match.

## 1.0.0 (2026-07-20) — ready for first test users

- **Suggestions earn their keep.** Every card now says why it fired
  ("because: 9 requests in the last 30 minutes") and its button does the
  thing instead of asking for applause: copy the critique prompt, start a
  real five-minute break (Drippy pings when it is up), reveal exactly which
  AI tells he spotted, drop a fresh-start brief on the clipboard, open the
  right window. Dismiss is a quiet ×. (Jack's steer: actionable, not
  decorative.)
- **First-run tour.** On a fresh install Drippy introduces himself: six cards
  above his head while he demonstrates each mode live (glow, the violet
  warning, the footprint ring, his shapes). Skippable, replayable from
  💧 → Replay the tour, and the welcome sheet still follows.
- **Doze is deliberate now.** Instead of drifting half off-screen, an idle
  Drippy condenses in place into a small still droplet, clearly there and
  clearly clickable, and plumps back up on any sign of life.
- **Shapes redesigned and properly alive.** The bicycle is a clean
  step-through swoop with spinning spokes, speed streaks and Drippy's face
  riding on the seat post. The magnifying glass got a glassier lens with a
  deep inner rim: his magnified eyes blink and dart mid-inspection, a glint
  sweeps the glass and a sparkle pops off the rim.
- **Popups speak like Drippy.** Suggestion and warning bubbles grew
  speech-bubble tails that point at him from whichever side he is on, a
  springy pop-in, and a tiny blob signature (tinted red/violet/teal to the
  moment). The suggestion bubble hovers just above his head.
- **Popups stay put properly.** Bubbles hide during a drag, and the welcome,
  suggestions and trends windows open centred on whichever display Drippy
  lives on.
- **User guide** ([USER-GUIDE.md](USER-GUIDE.md)): every state, popup,
  permission and file location, plus install and uninstall.
- Streamlined: the 'ask sources' rotation tip merged into 'verify figures'
  (same action, one voice).

## 0.9.2 (2026-07-16)

- **Shapes redrawn as Drippy, not wireframes.** The bicycle and magnifying
  glass now morph the blob into a chunky, filled, soft object in his exact
  teal skin, so they look made of the same stuff Drippy is.
- **Shapes given purpose**, tied to the objectives: the **bicycle** rides in
  with a wellbeing nudge ("go take a break", the anti-fatigue objective made
  physical); the **magnifying glass** appears with an authenticity nudge
  ("I had a close look at your writing"). Clicking Drippy still cycles them
  for fun; a warning or the footprint always interrupts.

## 0.9.1 (2026-07-16)

- **Fixed**: half-wired shape overlays from the transform experiment were
  taking layout space, cutting Drippy off and showing a stray bicycle and
  magnifying glass. The shapes are now hidden overlays, and the feature is
  finished properly: **click Drippy** and it morphs into a bicycle (then a
  magnifying glass next click), popping back a moment later. Never during a
  warning or the footprint, where clicks keep their real jobs.

## 0.9.0 (2026-07-16) — the voice of reason

Drippy's identity: not the intern who does your work, the colleague who stops
you sending the wrong thing. A better Clippy: high accuracy, real value, no
daily caps (abundance doctrine).

- **Suggestion engine** ([suggestions.js](suggestions.js)): a launch catalogue
  of 30 nudges across six families (authenticity, practice, wellbeing, usage,
  onboarding, guard), triggered by rules over signals we already sense
  (clipboard in/out, session rhythm, request cadence, model/tokens, time of
  day). Ranked by least-dismissed; dismissals stretch a cooldown rather than
  retiring a nudge; outcomes logged locally so the catalogue earns its place.
- **AI-tell detector** ([aitell.js](aitell.js)): rule-based, on-device. Text
  you copy out of Claude gets read for machine-writing fingerprints (em
  dashes, tell-phrases, uniform rhythm, matching bullets, hedges) so Drippy
  can nudge a human voice back in before it ships.
- **Delivery**: a teal suggestion mini-bubble that auto-shows beside Drippy,
  never stealing focus, then tucks away; plus a reviewable **Suggestions** feed
  (💧 menu) so nothing is ever lost when you're heads-down.
- Everything on device, verdicts only, no AI at runtime. Never modal, never
  does your work.

## 0.8.0 (2026-07-15)

- **Drippy dozes off to the corner.** After a while idle, Drippy slopes off to
  the nearest screen corner and naps there (droops, bobs slowly), then bounces
  back to its home spot the moment you need it: open Claude, an AI request, a
  privacy event, a hover or a drag all wake it. A fond, quiet nod to Clippy,
  the corner companion, but without the interruption.
- **The footprint ring, clarified.** The three arcs are now labelled pillars
  and behave as gauges that fill toward a daily reference, so a light day
  shows short arcs and a heavy day fuller ones: amber = AI usage, green =
  environment, violet = privacy. **Hover Drippy in footprint mode** for the
  breakdown (requests and tokens, Wh / CO₂e / water, privacy warnings).

## 0.7.0 (2026-07-15)

- **Risk-tiered privacy warnings.** Not everything sensitive is equally risky
  to share with Claude, and false alarms erode trust in the real ones. Drippy
  now grades findings (see PRIVACY.md, informed by 2026 research on what
  actually happens to data you paste into Claude):
  - **Tier 1 critical** (credentials & secrets, payment, government IDs):
    the full alarm, wide eyes, red exclamation badge, and the menu-bar eyes go
    wide. The exclamation badge is now reserved for this tier only.
  - **Tier 2 caution** (phone, date of birth): a gentle squint, violet, no
    badge, menu bar stays a normal glance.
  - **Tier 3 low** (your own email): noted in your trends but no warning at
    all, because a single email you've already given Claude is not a risk.
- Dev builds now have separate "Simulate critical warning" and "Simulate
  caution" controls.

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
