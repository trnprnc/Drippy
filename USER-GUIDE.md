# Drippy user guide

Drippy is your AI transparency companion: a small always-on-top blob that makes the hidden side of AI usage visible. He watches three things on your Mac and speaks in colour and posture, never sound: how much AI you use, what it costs the environment, and whether anything private is about to slip out. Everything happens on your Mac. Drippy has no account, no cloud and no analytics.

This guide covers the test build (macOS, Apple silicon).

## Installing

1. Download `Drippy-mac-arm64.zip` and unzip it.
2. Drag `Drippy.app` into your `Applications` folder.
3. Open it. Because this test build is not yet notarised, macOS will refuse the first launch:
   - macOS 15 (Sequoia) or later: open System Settings → Privacy & Security, scroll down, and click "Open Anyway" next to the Drippy message, then confirm.
   - Earlier macOS: right-click `Drippy.app` and choose Open, then Open again.
4. Drippy appears near the bottom-right of your screen, with a water drop (💧) in the menu bar.

Drippy starts automatically at login. Quit him any time from 💧 → Quit Drippy.

## First run

Drippy introduces himself with a short tour: six little cards above his head that walk through everything below. Skip it if you like; replay it any time from 💧 → Replay the tour. After the tour his welcome sheet opens, which explains exactly what he can and cannot see. That sheet stays available under 💧 → About Drippy.

## Reading Drippy

Drippy is silent by default. His body is the interface:

| What you see | What it means |
| --- | --- |
| Calm bobbing, no eyes | Resting. No AI activity on this Mac. |
| Eyes open | Claude is in front of you, or your request is running. The eyes are always about you, not the machine. |
| Eyes shift, body tips | You are typing; Drippy watches your work. |
| Cyan glow, breathing | AI energy is flowing on this Mac, from your request or a background agent. |
| Violet, gentle squint | Caution: something mildly sensitive (a phone number, a date of birth) is in your clipboard or composer. |
| Violet, wide eyes, red "!" badge | Critical: a secret (an API key, card number, password) is about to leave your Mac. The menu bar eyes go wide too. Hover him for details. |
| Dimmed, shrunk, with a ring | Your day's footprint (see below). |
| A small still droplet | Dozing. After a long idle he condenses in place to stay out of your way, and plumps back up the moment you hover, click or start working. |
| Suddenly a bicycle | A wellbeing nudge: you have been at it a while, go stretch your legs. |
| Suddenly a magnifying glass | An authenticity nudge: he has had a close look at your writing. |

Click Drippy any time and he will playfully morph into his shapes. Drag him anywhere; where you drop him becomes home.

## Privacy warnings

While you are using Claude, Drippy checks your clipboard and (optionally) your typing for sensitive content before it is sent. Detection happens entirely on-device and the content is discarded instantly; only the category ("Anthropic API key", "phone number") is kept.

When Drippy turns violet, hover him. A bubble explains what he spotted, where it is, and what to do about it. For clipboard secrets there is a one-click "Clear clipboard" remedy. Click Drippy to acknowledge and dismiss the warning.

Warnings are tiered so he never cries wolf:

- **Critical** (badge, wide eyes): credentials, API keys, payment details, government IDs. These are exploitable and hard to revoke.
- **Caution** (a quiet squint, no badge): a phone number or date of birth.
- **Noted only** (no warning): your own email address. It appears in your trends but Drippy will not interrupt you for it.

## Suggestions: a voice of reason

While you work, Drippy offers small, practical suggestions in a bubble above him. Each card tells you why it fired ("because: 9 requests in the last 30 minutes"), and its button does the thing rather than just nodding at it:

- **Copy critique prompt** puts a ready-made "attack this idea" prompt on your clipboard.
- **Take 5 minutes now** starts a real five-minute break timer; Drippy tells you when it is up.
- **What gave it away?** expands exactly which AI tells he spotted in text you copied.
- **Copy fresh-start brief**, **Copy question template** and friends drop ready-to-fill prompts on your clipboard.
- Others open the right window for you (trends, the footprint ring, the feed).

Suggestions never steal focus and fade away on their own; the quiet × dismisses one. Acting and dismissing both teach Drippy how often that kind of nudge should return. Every suggestion is kept in a reviewable feed at 💧 → Suggestions, so nothing is ever lost.

## Your day's footprint

Choose 💧 → Show day's footprint. Drippy dims and wears a ring of three gauges, each filling toward a typical day's reference:

- **Green**: environment (energy, carbon, water).
- **Amber**: AI usage (requests and tokens).
- **Violet**: privacy events.

Hover him while the ring is up for the numbers behind each arc. Click him (or untick the menu item) to put the ring away. The day rolls over at midnight and yesterday joins your history.

## Usage trends

💧 → Usage trends shows your last 30 days: energy, requests and privacy events per day, totals for the week, and a breakdown by app. All of it is stored locally in `~/Library/Application Support/Drippy/history/` and never uploaded.

About the numbers: network-observed usage is estimated from traffic volume and carries a wide uncertainty (about ±3×). Claude Code usage is exact, read from its own local session logs (token counts only, never message content). Impact factors are versioned and source-cited; see METHODOLOGY.md in the repository.

## The menu bar drop

The 💧 icon mirrors Drippy's state (its eyes go wide during a critical warning) and its menu holds everything:

- Live status line and what Drippy is currently watching
- Today's requests, tokens and estimated energy, water and carbon
- The last privacy event, if any
- Show day's footprint
- Suggestions, Usage trends, About Drippy, Replay the tour
- Reset day, Quit Drippy

## One optional permission

To warn you about sensitive content *as you type it* into Claude, Drippy needs macOS Accessibility access (System Settings → Privacy & Security → Accessibility). This is optional: without it the clipboard guard and everything else still work. Drippy never stores what he reads there; text is checked on-device and discarded.

If the permission is missing, the menu shows a shortcut to grant it.

## What Drippy can see, and what he cannot

- He watches **traffic patterns** to Anthropic (timing and volume). He cannot and does not decrypt or read your conversations.
- He knows **that** you are typing (system idle timer), never what you type, except the optional scan above.
- He checks your **clipboard only while you are using Claude**, and stops a few minutes after you leave.
- His only network activity is looking up Anthropic's published addresses. Your data never leaves the Mac.

## Data on disk

| What | Where |
| --- | --- |
| Today's counters and position | `~/Library/Application Support/Drippy/` |
| Usage history (daily and per-request) | `~/Library/Application Support/Drippy/history/` |
| Suggestion feed and learning | `~/Library/Application Support/Drippy/suggestions-state.json` |
| Log file | `~/Library/Logs/Drippy.log` |

Delete those and Drippy forgets everything. 💧 → Reset day clears just today's counters.

## Uninstalling

Quit Drippy, delete `/Applications/Drippy.app`, and remove the data folders above if you want a clean slate.

## Known limits of this test build

- Apple silicon (M-series) Macs only.
- Watches Anthropic traffic (Claude Desktop, Claude Code, browser Claude) only; other AI providers come later.
- Not yet notarised, hence the first-launch step above.
- Impact figures for network-observed apps are estimates with wide bands, by design, until finer sensing lands.

## Feedback

Tell us the moment Drippy feels wrong: a warning that should not have fired, a suggestion that missed, a number that looks off. The log file above plus a rough time of day is usually enough for us to trace it.
