# Drippy

**The transparency layer for your AI use.** A small pill in your Mac's menu bar
that meters what your AI work actually costs: energy, water, carbon, and the
API-rate value behind it. Pro-transparent-AI, not anti-AI.

> **Built for Claude Code.** Exact measurement reads Claude Code's own local
> session records, so that is where Drippy is precise and where every feature
> works. Claude Desktop and browser Claude are still metered, but only estimated
> from network traffic (±3×) and never priced. If you do not use Claude Code, you
> will see two fuzzy numbers and no spend figure.

[![Drippy — built for Claude Code](https://drippy-ten.vercel.app/badge.svg)](https://github.com/trnprnc/Drippy)

[**Download for macOS**](https://github.com/trnprnc/Drippy/releases/latest) ·
[Privacy design](PRIVACY.md) · [Methodology](METHODOLOGY.md) · [User guide](USER-GUIDE.md)

---

## Why this exists

Most AI usage figures are guesses. Drippy's are not, for the workload that
matters most.

Claude Code writes exact provider token counts to its own local session records.
Drippy reads those numbers (the numbers only, never message content) and prices
them at Anthropic's published rates. So for Claude Code there is **no estimation
in the token counts at all**, and the only uncertainty left is the energy factor
table, which is versioned and cited.

This matters more than it sounds. In real agentic sessions **95 to 97% of tokens
are cache reads**: the conversation being re-read every turn. Tools that report
"total tokens" as input plus output silently drop almost all of it. Drippy counts
every class separately and shows you the split.

**The source is public so you can check all of this yourself.** A tool that asks
you to trust its numbers should let you audit them.

## Install

Requires an Apple silicon Mac, macOS 13 or later.

1. Download the [latest release](https://github.com/trnprnc/Drippy/releases/latest)
   and unzip it, then drag **Drippy.app** into Applications.
2. This build is signed ad-hoc but **not notarised**, so macOS blocks it on first
   open. Clear the download flag once, in Terminal:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Drippy.app
   ```

   Then open it normally. (**System Settings → Privacy & Security → Open Anyway**
   also works on some macOS versions, but the command above is reliable.)
3. Drippy appears as a small dark pill in the menu bar and starts at login. Drag
   it along the bar; it remembers where.

Yes, that step is friction, and it is honest about where the project is: proper
Developer ID signing and notarisation remove it entirely and are the next thing
on the list. If you see **"Drippy is damaged and can't be opened"**, you have a
build from before 27 July 2026, when the bundle was being modified after signing
and shipped with an invalid signature. Download again.

**Drippy requires no macOS permissions.** No Accessibility, no Automation.

## Reading the pill

| Signal | Meaning |
|---|---|
| Dark pill | Quiet. No AI activity right now. |
| Lit teal, shimmer sweeping | AI energy flowing, yours or a background agent's. It holds steady through the gaps between an agent's calls, so "no glow" reliably means finished. |
| Violet | Caution: something mildly sensitive (a phone number, a date of birth) is on your clipboard. |
| Swollen below the bar, red "!" | Critical: a secret or identifiable personal data about someone else is about to be pasted into Claude. The only time Drippy takes up space uninvited. |
| Hover | Today so far: energy, water, API-rate value. |
| Click | Usage trends. |
| Right-click | Trends, what Drippy can see, reset day, quit. |

## Usage trends

Three ranges (today, this week, all time), each headlined by energy, water and
API-rate value, and each figure diveable down to its derivation:

- **Where it comes from.** A flowing view of the token classes: how crowded a
  lane is carries its share of the tokens, how fast and bright it runs carries
  its share of the energy. Volume and cost, side by side.
- **True value.** Tell Drippy your Claude plan and it expresses measured
  API-rate value against what that plan costs over the same period. A yardstick,
  not a bill: a subscription is flat-rate, so the two are different things.
- **How sure is this.** Measured versus estimated, split explicitly.
- **The derivation drawer.** Any figure opens the formula, that range's real
  drivers substituted in, the factor values, their citations, and the
  uncertainty band.

## How the numbers are made

| Source | Basis | Uncertainty |
|---|---|---|
| Claude Code tokens | **Measured.** Exact counts from local session records, per token class. | None in the counts |
| Spend | **Measured.** Those counts at Anthropic list rates, cache-aware. | None, though list rate ≠ your subscription |
| Other AI traffic | **Estimated** from network byte volume. | **±3×** |
| Energy, water, carbon | Derived from tokens via [impact-factors.json](impact-factors.json). | Factor band, stated in-app |

Every factor carries its sources, the figure taken, and what better data we are
still chasing, in [impact-sources.json](impact-sources.json). Read
[METHODOLOGY.md](METHODOLOGY.md) before quoting any of it.

## Architecture

A fidelity ladder. Each rung is an adapter emitting the same events, so the
product degrades gracefully to whatever is available:

- **L0 presence.** Frontmost app plus the system input-idle timer, never
  keystrokes. [engagement.js](engagement.js)
- **L1 flow metadata.** Per-process traffic to Anthropic's address block
  (both IPv4 `160.79.104.0/23` and IPv6; machines flip between them, and an
  IPv4-only matcher goes silently blind). Bytes only, no decryption.
  [monitor.js](monitor.js)
- **L2 on-device content.** The clipboard, scanned in memory by pure rules
  during an active Claude session. Verdicts leave the function, never text.
  [pii.js](pii.js), [privacy.js](privacy.js)
- **L3 exact provider usage.** Claude Code's own session records, read
  forward and backfilled, deduped by message id. [claude-code.js](claude-code.js)

Impact arithmetic is lookup tables and sums in [impact.js](impact.js). **No AI
calls at runtime, by principle.**

**Locked decisions:** no TLS interception for consumers, ever. Employee-first
reporting in any commercial tier. Estimates ship with uncertainty bands and
improve in the open.

## Developing

```sh
npm install
npm run start:app   # run from source, launched via LaunchServices
npm run dist        # build dist/Drippy-<version>.dmg and .zip
node test/*.test.js # unit tests: adapter completeness, history, presence, PII, sync
```

Logs: `~/Library/Logs/Drippy.log`
State and history: `~/Library/Application Support/Drippy/`

Optional sync ingest (off by default, see [DATA-STORAGE.md](DATA-STORAGE.md)):

```sh
cd server && npm run dev   # memory store on :8787; the dev app points here
```

## The badge

If Drippy meters your project's AI work and you want to say so:

[![Drippy — built for Claude Code](https://drippy-ten.vercel.app/badge.svg)](https://github.com/trnprnc/Drippy)

**Markdown**

```markdown
[![Drippy — built for Claude Code](https://drippy-ten.vercel.app/badge.svg)](https://github.com/trnprnc/Drippy)
```

**HTML**

```html
<a href="https://github.com/trnprnc/Drippy"><img src="https://drippy-ten.vercel.app/badge.svg" alt="Drippy — built for Claude Code" height="28"></a>
```

## Licence

Source-available, **not open source**. Published so you can read and verify what
Drippy does; publication is not a grant of licence. See [LICENSE](LICENSE). If
you want to use any of it, please ask.

## Status

Test build. Known limits:

- Apple silicon only, no universal binary yet.
- Anthropic traffic only. Other providers come later.
- Not notarised, hence the first-launch step.
- Figures for network-observed apps are estimates with wide bands.

## Troubleshooting

- **Pill invisible.** Quit, delete
  `~/Library/Application Support/Drippy/position.json`, reopen.
- **All-time trends look thin.** History is rebuilt from Claude Code transcripts
  on first run. If a previous version already recorded usage, the backfill is
  skipped to avoid double counting.
- **"Electron failed to install correctly" (dev only).** Extract the cached zip
  by hand:
  `ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip node_modules/electron/dist/`
  then `printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt`.
