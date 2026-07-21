# Drippy user guide

Drippy is the transparency layer for your AI use. He is a small droplet that sits on top of your windows and meters what your AI usage really costs: energy, water, carbon, money and privacy. Everything happens on your Mac. Drippy has no account, no cloud and no analytics.

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

Drippy introduces himself with a short four-card tour. Skip it if you like; replay it any time from 💧 → Replay the tour. After the tour his welcome sheet opens, which explains exactly what he can and cannot see. That sheet stays available under 💧 → About Drippy.

## Reading Drippy

Drippy is deliberately small and deliberately quiet. The window is click-through: clicks land on whatever is beneath it, except on the droplet itself. The whole visual language:

| What you see | What it means |
| --- | --- |
| A still droplet | Quiet. No AI activity on this Mac. |
| Cyan glow, breathing | AI energy is flowing right now, from your request or a background agent. Both are metered. |
| Violet droplet | Caution: something mildly sensitive (a phone number, a date of birth) is in your clipboard or composer. |
| Full size, wide eyes, red "!" badge | Critical: a secret (an API key, card number, password) is about to leave your Mac. This is the only state in which Drippy takes up space uninvited. The menu bar eyes go wide too. |

Drag the droplet anywhere; where you drop him becomes home.

## The hover card: today's numbers

Hover the droplet at any moment for today so far:

- **Energy** in Wh and **carbon** in g CO₂e
- **Water** in mL (onsite cooling plus the water behind the electricity)
- **AI usage**: requests and tokens
- **Privacy**: how many warnings fired today
- **Value**: what your measured usage would cost at Anthropic's current API list rates

The card's footer translates the day into everyday equivalents: phone charges, glasses of water, kilometres in a petrol car. The same numbers live in the 💧 menu.

During a privacy warning the hover card shows the warning instead: what was spotted, where it is, why it matters, and (for clipboard secrets) a one-click "Clear clipboard" remedy.

## Click: usage trends

Click the droplet (or 💧 → Usage trends) for your last 30 days: energy, requests and privacy events per day, weekly totals, and a breakdown by app. All of it is stored locally in `~/Library/Application Support/Drippy/history/` and never uploaded.

About the numbers: network-observed usage is estimated from traffic volume and carries a wide uncertainty (about ±3×). Claude Code usage is exact, read from its own local session logs (token counts only, never message content). Spend is computed only from those exact counts, at current list prices with cache reads and writes priced correctly; estimated traffic is never priced. Impact factors are versioned and source-cited; see METHODOLOGY.md in the repository.

## Privacy warnings

While you are using Claude, Drippy checks your clipboard and (optionally) your typing for sensitive content before it is sent. Detection happens entirely on-device and the content is discarded instantly; only the category ("Anthropic API key", "phone number") is kept.

Warnings are tiered so he never cries wolf:

- **Critical** (full size, badge, wide eyes): credentials, API keys, payment details, government IDs. These are exploitable and hard to revoke.
- **Caution** (a violet droplet): a phone number or date of birth.
- **Noted only** (no warning): your own email address. It appears in your trends but Drippy will not interrupt you for it.

Click the droplet during a warning to acknowledge and dismiss it.

## Notices

When the meters show something worth knowing, Drippy raises a small card above the droplet. Every notice says why it fired ("because: 14 requests today, mostly short answers") and its button does the thing:

- **Copy batch template** or **Copy fresh-start brief** puts the lighter-usage remedy on your clipboard.
- **Copy '/model sonnet'** when a big model has been doing small jobs.
- **Open usage trends** when a background agent has been drawing energy solo for half an hour, or on a heavy day.
- Guard notices suggest key-hygiene habits after near-misses.

Notices never steal focus and fade on their own; the quiet × dismisses one. Every notice is kept in a reviewable feed at 💧 → Notices.

## The menu bar drop

The 💧 icon mirrors Drippy's state (its eyes go wide during a critical warning) and its menu holds everything: the live status line, today's numbers with equivalents and measured spend, the last privacy event, Notices, Usage trends, About Drippy, Replay the tour, Reset day and Quit.

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
| Usage history | `~/Library/Application Support/Drippy/history/` |
| Notice feed and learning | `~/Library/Application Support/Drippy/suggestions-state.json` |
| Log file | `~/Library/Logs/Drippy.log` |

Delete those and Drippy forgets everything. 💧 → Reset day clears just today's counters.

## Uninstalling

Quit Drippy, delete `/Applications/Drippy.app`, and remove the data folders above if you want a clean slate.

## Known limits of this test build

- Apple silicon (M-series) Macs only.
- Watches Anthropic traffic (Claude Desktop, Claude Code, browser Claude) only; other AI providers come later.
- Not yet notarised, hence the first-launch step above.
- Impact figures for network-observed apps are estimates with wide bands, by design, until finer sensing lands.
- "Value" is what the usage would cost at API list rates; if you pay via a subscription your bill will differ.

## Feedback

Tell us the moment Drippy feels wrong: a warning that should not have fired, a notice that missed, a number that looks off. The log file above plus a rough time of day is usually enough for us to trace it.
