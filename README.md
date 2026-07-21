# Drippy: the transparency layer

A small pill that lives in your menu bar and meters what your AI usage
really costs: energy, water, carbon, money and privacy. Pro-transparent-AI,
not anti-AI. Always present, never in the way: the window is click-through
except over the pill itself, and Drippy only ever takes up space for a
critical privacy warning.

New here? Drippy gives a four-card tour on first launch. The full manual is
[USER-GUIDE.md](USER-GUIDE.md).

## Install (macOS, Apple Silicon)

1. Download `Drippy-<version>.dmg`, open it, drag **Drippy** to Applications.
2. First launch: this build isn't notarised yet, so macOS will refuse it once.
   Open **System Settings → Privacy & Security**, scroll down, click
   **Open Anyway**. (Technical users: `xattr -d com.apple.quarantine /Applications/Drippy.app`.)
3. Drippy appears as a small dark pill in your menu bar. It starts at login
   from now on. Drag the pill along the bar; it remembers where.
4. To catch sensitive data **as you type it**, before it is sent (not just
   when you paste), grant Accessibility when the welcome window offers it
   (System Settings → Privacy & Security → Accessibility → enable Drippy, and
   allow the "control System Events" prompt). Without it only the clipboard
   guard runs.

Requirements: Apple Silicon Mac, macOS 13+. See [PRIVACY.md](PRIVACY.md).

## How to read the pill

| Signal | Meaning |
|---|---|
| Dark pill | quiet; no AI activity right now |
| Lit teal, shimmer sweeping | AI energy flowing right now, yours *or* a background agent's (a Claude Code session, for example) |
| Violet pill | caution-level sensitive content (phone number, date of birth) in your clipboard or composer |
| Swollen below the bar + "!" | critical: a secret detected *before it leaves your machine*: API keys and tokens (Anthropic, OpenAI, GitHub, AWS, Stripe, Slack, Google, JWTs), private key files, database connection strings, .env-style secrets, cards and bank details, government IDs, and identifiable personal data about *other people* (a patient's details, children's grades, staff records). Hovering shows what it found, why it matters, and the remedy; a click acknowledges |
| Hover | today's numbers: energy, water, measured spend |
| Click | 30-day usage trends |
| Right-click | the rest: trends, what Drippy can see, reset, quit |

**Usage trends** holds the full picture: 30-day charts (energy, requests,
privacy events), 7-day totals with everyday equivalents, a per-app breakdown
and a per-day data table, with each number's provenance stated.

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
  [privacy.js](privacy.js). The clipboard is watched throughout an active
  Claude session (not just when Claude is frontmost), so a secret copied in a
  browser or `.env` is caught before you paste it. Next: claude.ai browser
  extension (exact tokens, pre-send warnings on the web).
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

- **Pill invisible:** reset its position by quitting and deleting
  `~/Library/Application Support/Drippy/position.json`.
- **Typed-text scan inactive:** the right-click menu shows "Enable typed-text
  privacy scan" if the Accessibility grant is missing. Drippy re-checks every 20s
  after you grant it; no restart needed.
- **"Electron failed to install correctly" (dev only):** extract the cached
  zip manually: `ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip node_modules/electron/dist/`
  then `printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt`.
