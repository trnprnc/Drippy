# Drippy privacy design

Drippy exists to make AI's hidden impacts visible. A tool like that only works
if you can trust it more than the things it watches. This document describes
exactly what Drippy can see, what it cannot, and why — and how those promises
are enforced *structurally* in the code, not just by policy.

## The three rules

1. **Everything stays on your Mac.** Drippy has no account, no cloud, no
   telemetry, and no analytics. Its only network activity is DNS lookups of
   `claude.ai` / `api.anthropic.com` (to learn which addresses to watch).
   It never transmits anything, anywhere.

2. **Verdicts, not content.** Wherever Drippy touches text (clipboard,
   composer), the text is scanned in memory and discarded in the same
   function call. Only a category verdict survives — `"api key"`,
   `"email address"` — never the value. There is no code path that stores,
   logs, or transmits scanned content.

3. **Metadata before content.** Drippy prefers the least-invasive signal that
   can do the job, and each deeper level is separately opt-in.

## What each sensor sees

| Sensor | What it reads | What it keeps | Permission |
|---|---|---|---|
| Network monitor | which processes have connections to Anthropic's address block; byte counts and timing (encrypted payloads are never decrypted — Drippy could not read your conversations if it wanted to) | request start/end, app name, byte totals | none |
| Engagement | frontmost app name + seconds since last keyboard/mouse input (a system-wide timer — individual keystrokes are invisible to Drippy) | "present" / "typing" booleans | none |
| Clipboard guard | clipboard text, rescanned only when it changes, only while you're in a Claude surface | PII category verdicts only | none |
| Typed-text guard (optional) | the focused Claude composer's text via macOS Accessibility, only while you're typing in Claude | PII category verdicts only | Accessibility + Automation, granted by you in System Settings |

**Explicitly ruled out, permanently:** TLS interception / installing a root
certificate. Drippy will never decrypt your traffic — not for any feature.

## What Drippy stores on disk

- `~/Library/Application Support/Drippy/position.json` — where you left the blob
- `~/Library/Application Support/Drippy/state.json` — today's counters (request
  count, token estimates, Wh/water/CO₂e, privacy-event count and last category)
- `~/Library/Logs/Drippy.log` — operational log: state changes, app names,
  byte/token estimates, privacy event *categories*. Never content.
- `~/Library/Application Support/Drippy/history/` — your local usage history
  (per-day rollups and per-event records: timestamps, app names, token/energy
  estimates, privacy categories). This powers the Usage trends window. It
  never leaves the device; any future community/aggregate sharing will be
  strictly opt-in and documented here first.

Delete any of these at any time; Drippy recreates them empty.

## The estimates in the tray

Impact numbers are derived from traffic *volume* (bytes ≈ tokens ≈ energy),
never from reading your conversations. See [METHODOLOGY.md](METHODOLOGY.md).

## Verifying these claims

Drippy's source is small and readable — `monitor.js`, `engagement.js`,
`privacy.js`, `pii.js` are the complete sensing surface (~500 lines). Check
that `scanText()` results are the only thing that leaves `privacy.js`, and
that the app makes no HTTP requests. We intend to keep it that way and to
publish the source so you don't have to take our word for it.
