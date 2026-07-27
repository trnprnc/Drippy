# Drippy privacy design

Drippy exists to make AI's hidden impacts visible. A tool like that only works
if you can trust it more than the things it watches. This document describes
exactly what Drippy can see, what it cannot, and why, and how those promises
are enforced *structurally* in the code, not just by policy.

## The rules

1. **Verdicts, not content.** Wherever Drippy touches text (the clipboard,
   during an active Claude session), the text is scanned in memory and
   discarded in the same function call. Only a category verdict survives, such as "API key" or
   "email address", never the value. There is no code path that stores,
   logs, or transmits scanned content.

2. **Metadata before content.** Drippy prefers the least-invasive signal that
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
| Claude Code usage | the `usage` numbers and model id from Claude Code's own local session transcripts (`~/.claude/projects`). The message text in those files is never read | exact token counts and model, per message | none |

**Drippy requires no macOS permissions at all.** Every sensor above runs on
signals the system already exposes.

**Explicitly ruled out, permanently:** TLS interception and root
certificates. Drippy will never decrypt your traffic, for any feature.

**Removed in 2.2.0: the typed-text guard.** Earlier versions could read the
focused Claude composer through the macOS Accessibility API to catch a secret
as it was typed. It was the most invasive thing Drippy did, it cost every user
a permission grant, and it put Drippy inside the text of your messages as you
wrote them. Drippy is the transparency layer for AI impact first, so that
reach is no longer justified. The clipboard guard, which needs no permission,
still catches the paste path that carries almost all real secrets.

## How loudly Drippy warns (risk tiers)

Not everything sensitive is equally risky to share with Claude, and crying
wolf over the harmless things trains you to ignore the warnings that matter.
So Drippy grades what it finds:

- **Tier 1, critical (full alarm + badge):** credentials and secrets (API
  keys, tokens, private keys, database URLs, passwords), payment details
  (cards, bank), government IDs (SSN, National Insurance), and identifiable
  personal data about other people: health details about a person,
  information about children, and lists of personal records. The first
  group can cause real or irreversible harm to you; the second is a
  data-protection breach against people who never chose to share.
  De-identification in a training pipeline does not neutralise either.
- **Tier 2, caution (violet, no badge):** phone numbers, dates of birth,
  and HR details about a named person. Privacy-sensitive but
  low-to-moderate harm on their own.
- **Tier 3, low (noted, no warning):** your own email address. You already
  gave Claude your email to use it, so a single one is not a meaningful new
  exposure. Drippy counts it for your trends but does not interrupt you.

Third-party detection is anchored rule-matching: a role word or record
structure (patient, class list, appraisal, a name-and-grade line) must
co-occur with an identifier (a name, date of birth, NHS number, contact
details). A capitalised name alone never fires.

## What Drippy stores on disk

- `~/Library/Application Support/Drippy/position.json`: where you left the pill
- `~/Library/Application Support/Drippy/state.json`: today's counters (request
  count, token estimates, Wh/water/CO₂e, privacy-event count and last category)
- `~/Library/Logs/Drippy.log`: operational log with state changes, app names,
  byte/token estimates, and privacy event *categories*. Never content.
- `~/Library/Application Support/Drippy/history/`: your local usage history
  (per-day rollups and per-event records: timestamps, app names, token/energy
  estimates, privacy categories). This powers the Usage trends window.

Delete any of these at any time; Drippy recreates them empty.

## The estimates

Impact numbers are derived from traffic *volume* (bytes ≈ tokens ≈ energy),
never from reading your conversations. See [METHODOLOGY.md](METHODOLOGY.md).

## Verifying these claims

Drippy's source is small and readable. `monitor.js`, `engagement.js`,
`privacy.js` and `pii.js` are the complete sensing surface (about 500 lines).
Check that `scanText()` results are the only thing that leaves `privacy.js`.
We intend to publish the source so you don't have to take our word for it.
