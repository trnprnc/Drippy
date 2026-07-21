# Drippy user guide

Drippy is the transparency layer for your AI use. He is a small pill that lives in your menu bar and meters what your AI usage really costs: energy, water, carbon, money and privacy.

This guide covers the test build (macOS, Apple silicon).

## Installing

1. Download `Drippy-mac-arm64.zip` and unzip it.
2. Drag `Drippy.app` into your `Applications` folder.
3. Open it. Because this test build is not yet notarised, macOS will refuse the first launch:
   - macOS 15 (Sequoia) or later: open System Settings → Privacy & Security, scroll down, and click "Open Anyway" next to the Drippy message, then confirm.
   - Earlier macOS: right-click `Drippy.app` and choose Open, then Open again.
4. Drippy appears as a small dark pill in your menu bar.

Drippy starts automatically at login. Quit him any time from right-click → Quit Drippy.

## First run

Drippy introduces himself with a short four-card tour. After the tour his welcome sheet opens, which explains exactly what he can and cannot see. That sheet stays available under right-click → What Drippy can see.

## Reading Drippy

Drippy is deliberately small and deliberately quiet. The window is click-through: clicks land on whatever is beneath it, except on the droplet itself. The whole visual language:

| What you see | What it means |
| --- | --- |
| A dark pill | Quiet; no AI activity right now. |
| Lit teal, a shimmer sweeping through | AI energy is flowing right now, from your request or a background agent. Both are metered. |
| Violet pill | Caution: something mildly sensitive (a phone number, a date of birth) is in your clipboard or composer. |
| Swollen, hanging below the bar, red "!" badge | Critical: a secret (an API key, card number, password) is about to leave your Mac. This is the only state in which Drippy takes up space uninvited. |

Drag the pill along the menu bar; where you drop him becomes home.

## Hover: today's numbers

Hover the pill at any moment and it opens with today so far: **energy** in Wh, **water** in mL and **measured spend** (requests, before any spend is measured). The full picture, including carbon, tokens, per-app breakdown and everyday equivalents, is one click away in usage trends.

During a privacy warning a card appears below the pill instead: what was spotted, where it is, why it matters, and (for clipboard secrets) a one-click "Clear clipboard" remedy.

## Click: usage trends

Click the pill (or right-click → Usage trends) for your last 30 days: energy, requests and privacy events per day, 7-day totals with everyday equivalents, a breakdown by app, and a full data table (requests, tokens, energy, water, carbon, privacy events and measured spend per day).

About the numbers: network-observed usage is estimated from traffic volume and carries a wide uncertainty (about ±3×). Claude Code usage is exact, read from its own local session logs (token counts only, never message content). Spend is computed only from those exact counts, at current list prices with cache reads and writes priced correctly; estimated traffic is never priced. Impact factors are versioned and source-cited; see METHODOLOGY.md in the repository.

## Privacy warnings

While you are using Claude, Drippy checks your clipboard and (optionally) your typing for sensitive content before it is sent. Detection happens entirely on-device and the content is discarded instantly; only the category ("Anthropic API key", "phone number") is kept.

Warnings are tiered so he never cries wolf:

- **Critical** (swollen, badge): credentials, API keys, payment details, government IDs, and identifiable personal data about other people: a patient's details, information about children, a list of personal records. The first group is exploitable and hard to revoke; the second is other people's data, entered before they had any say.
- **Caution** (a violet pill): a phone number, a date of birth, or HR details about a named person.
- **Noted only** (no warning): your own email address. It appears in your trends but Drippy will not interrupt you for it.

Click the pill during a warning to acknowledge and dismiss it.

## Notices

When the meters show something worth knowing, Drippy raises a small card below the pill. Every notice says why it fired ("because: 14 requests today, mostly short answers") and its button does the thing:

- **Copy batch template** or **Copy fresh-start brief** puts the lighter-usage remedy on your clipboard.
- **Copy '/model sonnet'** when a big model has been doing small jobs.
- **Open usage trends** when a background agent has been drawing energy solo for half an hour, or on a heavy day.
- Guard notices suggest key-hygiene habits after near-misses.

Notices never steal focus and fade on their own; the quiet × dismisses one.

## The right-click menu

Right-click the pill for the rest: the live status line, what is being watched, Usage trends, What Drippy can see, Reset day and Quit.

## The permission that completes the guard

Catching sensitive data at the point of entry, as it is typed and before it is sent, needs macOS Accessibility access (System Settings → Privacy & Security → Accessibility). Without it Drippy sees only what is pasted, not what is typed. Managed fleets can pre-approve the permission through MDM so every device is covered from enrolment. Drippy never stores what he reads there; text is checked on-device and discarded.

If the permission is missing, the right-click menu shows a shortcut to grant it.

## What Drippy can see, and what he cannot

- He watches **traffic patterns** to Anthropic (timing and volume). He cannot and does not decrypt or read your conversations.
- He knows **that** you are typing (system idle timer), never what you type, except the optional scan above.
- He checks your **clipboard only while you are using Claude**, and stops a few minutes after you leave.
- His only network activity is looking up Anthropic's published addresses.

## Data on disk

| What | Where |
| --- | --- |
| Today's counters and position | `~/Library/Application Support/Drippy/` |
| Usage history | `~/Library/Application Support/Drippy/history/` |
| Notice feed and learning | `~/Library/Application Support/Drippy/suggestions-state.json` |
| Log file | `~/Library/Logs/Drippy.log` |

Delete those and Drippy forgets everything. Right-click → Reset day clears just today's counters.

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
