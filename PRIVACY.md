# Drippy privacy design

Drippy exists to make AI's hidden impacts visible. A tool like that only works
if you can trust it more than the things it watches. This document describes
exactly what Drippy can see, what it cannot, and why, and how those promises
are enforced *structurally* in the code, not just by policy.

## The three rules

1. **Everything stays on your Mac.** Drippy has no account, no cloud, no
   telemetry, and no analytics. Its only network activity is DNS lookups of
   `claude.ai` / `api.anthropic.com` (to learn which addresses to watch).
   It never transmits anything, anywhere.

2. **Verdicts, not content.** Wherever Drippy touches text (clipboard,
   composer), the text is scanned in memory and discarded in the same
   function call. Only a category verdict survives, such as "API key" or
   "email address", never the value. There is no code path that stores,
   logs, or transmits scanned content.

3. **Metadata before content.** Drippy prefers the least-invasive signal that
   can do the job, and each deeper level is separately opt-in.

**Why the clipboard is watched during a session, not just when Claude is
frontmost:** in real work you copy a secret somewhere else (a browser, a
`.env` file, a password manager) and then paste it into Claude. To warn you
before that, Drippy checks the clipboard throughout an active Claude session,
including a few minutes after you tab away to grab something. It never scans
your clipboard when you have not been using Claude.

## What each sensor sees

| Sensor | What it reads | What it keeps | Permission |
|---|---|---|---|
| Network monitor | which processes have connections to Anthropic's address block; byte counts and timing (encrypted payloads are never decrypted, so Drippy could not read your conversations if it wanted to) | request start/end, app name, byte totals | none |
| Engagement | frontmost app name + seconds since last keyboard/mouse input (a system-wide timer; individual keystrokes are invisible to Drippy) | "present" / "typing" booleans | none |
| Clipboard guard | clipboard text, rescanned when it changes, throughout an active Claude session: while Claude is frontmost, or within ~3 minutes of using it, so a secret you copied in a browser, a .env file or a password manager is caught before you paste it. Scanning stops once you have not used Claude for a few minutes | concern category verdicts only | none |
| Typed-text guard (optional) | the focused Claude composer's text via macOS Accessibility, only while you're typing in Claude | concern category verdicts only | Accessibility + Automation, granted by you in System Settings |
| Claude Code usage | the `usage` numbers and model id from Claude Code's own local session transcripts (`~/.claude/projects`). The message text in those files is never read | exact token counts and model, per message | none |

**Explicitly ruled out, permanently:** TLS interception and root
certificates. Drippy will never decrypt your traffic, for any feature.

## How loudly Drippy warns (risk tiers)

Not everything sensitive is equally risky to share with Claude, and crying
wolf over the harmless things trains you to ignore the warnings that matter.
So Drippy grades what it finds:

- **Tier 1, critical (full alarm + badge):** credentials and secrets (API
  keys, tokens, private keys, database URLs, passwords), payment details
  (cards, bank), and government IDs (SSN, National Insurance). These can cause
  real or irreversible harm: account takeover, fraud, permanent identity
  theft. De-identification in a training pipeline does not neutralise a live
  secret. Drippy goes violet, eyes wide, with a red notification badge.
- **Tier 2, caution (a quiet squint):** phone numbers and dates of birth.
  Privacy-sensitive but low harm on their own. Drippy gives a gentle squint,
  no badge.
- **Tier 3, low (noted, no warning):** your own email address. You already
  gave Claude your email to use it, so a single one is not a meaningful new
  exposure. Drippy counts it for your trends but does not interrupt you.

(A future tier will catch *bulk* or *third-party* PII, e.g. a pasted list of
customer records, which is a genuine data-protection risk that a single
personal detail is not.)

## What Drippy stores on disk

- `~/Library/Application Support/Drippy/position.json`: where you left the blob
- `~/Library/Application Support/Drippy/state.json`: today's counters (request
  count, token estimates, Wh/water/CO₂e, privacy-event count and last category)
- `~/Library/Logs/Drippy.log`: operational log with state changes, app names,
  byte/token estimates, and privacy event *categories*. Never content.
- `~/Library/Application Support/Drippy/history/`: your local usage history
  (per-day rollups and per-event records: timestamps, app names, token/energy
  estimates, privacy categories). This powers the Usage trends window. It
  never leaves the device; any future community or aggregate sharing will be
  strictly opt-in and documented here first.

Delete any of these at any time; Drippy recreates them empty.

## The estimates in the tray

Impact numbers are derived from traffic *volume* (bytes ≈ tokens ≈ energy),
never from reading your conversations. See [METHODOLOGY.md](METHODOLOGY.md).

## Verifying these claims

Drippy's source is small and readable. `monitor.js`, `engagement.js`,
`privacy.js` and `pii.js` are the complete sensing surface (about 500 lines).
Check that `scanText()` results are the only thing that leaves `privacy.js`,
and that the app makes no HTTP requests. We intend to keep it that way and to
publish the source so you don't have to take our word for it.
