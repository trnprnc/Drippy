# Drippy: AI transparency companion

A small living blob that floats above your desktop and makes the hidden
impacts of AI usage visible: energy and water, privacy, and how much AI is
actually running on your machine. Pro-transparent-AI, not anti-AI. Silent by
default. Drippy speaks in colour and posture, never sounds or popups.

At rest Drippy is an anonymous, eyeless blob. **Eyes exist only when it has
something to show you.**

## Install (macOS, Apple Silicon)

1. Download `Drippy-<version>.dmg`, open it, drag **Drippy** to Applications.
2. First launch: this build isn't notarised yet, so macOS will refuse it once.
   Open **System Settings → Privacy & Security**, scroll down, click
   **Open Anyway**. (Technical users: `xattr -d com.apple.quarantine /Applications/Drippy.app`.)
3. Drippy appears bottom-right and in the menu bar as 💧. It starts at login
   from now on. Drag the blob wherever you like; it remembers.
4. *Optional but recommended:* to be warned **while you type** sensitive data
   into Claude, grant Accessibility when the welcome window offers it
   (System Settings → Privacy & Security → Accessibility → enable Drippy, and
   allow the "control System Events" prompt). Without it the clipboard guard
   still works.

Requirements: Apple Silicon Mac, macOS 13+. Everything runs locally, with no
account and no cloud. See [PRIVACY.md](PRIVACY.md).

## How to read the face

The face follows your attention in a progression:

| Signal | Meaning |
|---|---|
| Eyes forward | AI is in use: Claude is open in front of you, or your request is running |
| Eyes on the work | you're actively typing; eyes shift toward the composer and the body tips with them |
| Breathing glow (cyan) | AI energy flowing on this machine, yours *or* a background agent's (a Claude Code session, for example) |
| Warning: violet, wide eyes still on the work, pulsing | sensitive content detected on your clipboard or in the composer, *before it leaves your machine*: API keys and tokens (Anthropic, OpenAI, GitHub, AWS, Stripe, Slack, Google, JWTs), private key files, database connection strings, .env-style secrets, cards and bank details, government IDs, emails, phones, dates of birth. **Hover Drippy** for what it found, why it matters, and the remedy; click to acknowledge |
| Dim + ring | your day's footprint: green environment · amber energy · violet privacy |

The 💧 menu shows live status, today's totals (requests, tokens in/out,
Wh / water / CO₂e with their uncertainty band), the last privacy event, and,
because fairness cuts both ways, Drippy's own CPU use. **Usage trends…**
opens 30-day charts (energy, requests, privacy events, per-app breakdown)
built from your local history. History never leaves the device, and any
future community or aggregate view will be strictly opt-in.

All impact figures are **estimates (±3×)** from a versioned, source-cited
factor table. Read [METHODOLOGY.md](METHODOLOGY.md) before quoting them.

---

## Developing

```sh
npm install
npm run start:app   # run from source, detached via LaunchServices. Required
                    # for Accessibility permission to attribute correctly.
npm run dist        # build dist/Drippy-<version>.dmg + .zip
```

Logs: `~/Library/Logs/Drippy.log` · State: `~/Library/Application Support/Drippy/`

### Architecture: a fidelity ladder

Each rung is an adapter emitting the same events; the product degrades
gracefully to whatever the user has granted:

- **L0 presence/engagement**: frontmost app + system input-idle timer (never
  keystrokes) → [engagement.js](engagement.js)
- **L1 flow metadata**: per-process traffic to Anthropic's address block
  (160.79.104.0/23 + v6, both families matter), bytes both directions, no
  decryption → [monitor.js](monitor.js). Adaptive cadence: hot while you're
  present (~1s reaction), cold otherwise. Ships later as a push-based
  `NEFilterDataProvider` system extension with identical events.
- **L2 content, on-device only**: clipboard + Claude composer scanned
  in-memory by pure rules ([pii.js](pii.js)), verdicts only →
  [privacy.js](privacy.js). Next: claude.ai browser extension (exact tokens,
  pre-send warnings on the web).
- **L3 provider truth**: Anthropic Admin/Usage APIs (Drippy Commercial).

Impact arithmetic lives in [impact.js](impact.js) over
[impact-factors.json](impact-factors.json): lookup tables and sums,
**no AI calls at runtime**, by principle.

Locked product decisions: no TLS interception for consumers, ever;
employee-first reporting in the commercial tier; estimates ship with
uncertainty bands and improve in the open.

### The creature

[renderer/](renderer/) is pure CSS per the design handoff in
[design_handoff_drippy/](design_handoff_drippy/README.md) (direction
**1e "Blink"**); no image assets. The state machine drives composable signal
classes (`has-eyes`, `has-gaze`, `has-glow`) plus whole-body modes for
privacy and footprint.

### Release checklist (not yet done)

- [ ] Apple Developer ID signing + notarisation (removes the Open Anyway step)
- [ ] Universal binary (Intel + Apple Silicon)
- [ ] Auto-update feed
- [ ] Choose a licence (currently UNLICENSED, all rights reserved)
- [ ] Publish source

## Troubleshooting

- **Blob invisible:** it may be behind a fullscreen space edge; the 💧 menu
  is always there. Reset its position by quitting and deleting
  `~/Library/Application Support/Drippy/position.json`.
- **Typed-text scan inactive:** the 💧 menu shows "Enable typed-text privacy
  scan" if the Accessibility grant is missing. Drippy re-checks every 20s
  after you grant it; no restart needed.
- **"Electron failed to install correctly" (dev only):** extract the cached
  zip manually: `ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip node_modules/electron/dist/`
  then `printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt`.
