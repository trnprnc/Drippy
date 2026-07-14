# How Drippy estimates AI impact

Honest numbers about AI's footprint don't fully exist yet: no provider
publishes per-request figures for Claude. Drippy's answer is to estimate
openly rather than not at all. Every number carries an uncertainty band
(currently **±3×**), every assumption lives in a versioned, source-cited
factor table, and revisions are expected as provider and community data
improves. If you can improve a factor, we want the correction.

## Two paths to tokens

Drippy uses the most accurate token source available per app.

**Exact (Claude Code).** Claude Code writes a session transcript locally, and
every assistant message carries a provider `usage` object: real input, output
and the exact cache split (`cache_read` vs `cache_creation`). Drippy reads
those numbers directly (never the message content), so for the heaviest
workload on most developer machines there is *no token estimation at all*.
Measured on a real session: 94% of input tokens were cache reads, which cost
far less energy than fresh processing. A fixed "fresh fraction" guess would
have been wrong; the exact split is not.

**Estimated (everything else, for now).** For Claude Desktop and web, Drippy
estimates tokens from encrypted traffic volume: downlink bytes ≈ output
tokens, uplink bytes ≈ input tokens. No content is read. This path will be
replaced with exact counts as the browser extension (L2) lands.

## The energy pipeline

```
tokens (exact or estimated)  →  energy (Wh)  →  carbon (gCO₂e) + water (mL)
```

- **Output** tokens are priced at `whPer1kOutputTokens`.
- **Fresh input** (new prompt + cache creation) costs `inputTokenEnergyRatio`
  (about 10%) of an output token.
- **Cache-read input** costs `cacheReadEnergyRatio` (about 1%): served from
  the KV cache, no recomputation.
- The total is scaled by a **model tier** multiplier (`modelTiers`): larger
  models use more energy per token. Claude Code exposes the model per message;
  the estimated path cannot yet see it.
- **Carbon and water**: energy × world-average grid intensity
  (`gridGCo2PerKwh`) and datacentre water use (`waterMlPerWh`). Both will
  become region-aware.

Where the exact path applies, the only remaining uncertainty is the energy
factors themselves, not the token counts. That is the whole point: collapse
the estimation error one layer at a time.

## Current factors (v2026.07.4, provisional, 2026 data)

| Assumption | Value | Basis (2026 data) |
|---|---|---|
| `whPer1kOutputTokens` | 1.0 Wh | GPT-4o-class ≈ 0.31 Wh median per query; measured per-output-token 0.0001–0.002 Wh; decode is ≥96% of inference energy, giving ≈1 Wh per 1k output tokens for a Sonnet-class model |
| `inputTokenEnergyRatio` | 0.05 | prefill (input) is ≤3.4% of energy vs ≥96% for decode, so an input token costs ≈3–5% of an output token (more for very long contexts) |
| `cacheReadEnergyRatio` | 0.005 | two converging lines: Anthropic's cache-read price (0.1× input) and a measured 85–95% energy saving on a cache hit (5–15% of fresh input) |
| `modelTiers` | Opus 2.0 · Sonnet 1.0 · Haiku 0.25 | spans the measured 0.0001–0.002 Wh/token range by model size |
| `gridGCo2PerKwh` | 321 g | US regional grid (Claude runs in US regions; US hosts ~45% of AI datacentre capacity), vs ~396 g global average |
| `waterOnsiteMlPerWh` | 1.1 mL | onsite cooling WUE ≈ 1.1 L/kWh (disclosed range 0.2–1.8) |
| `waterOffsiteMlPerWh` | 1.25 mL | water to generate the electricity: US thermoelectric consumptive ≈ 1.25 L/kWh (EIA) |
| `uncertaintyBand` | ×⅓ … ×3 | shown wherever numbers appear |

The machine-readable source of truth is
[impact-factors.json](impact-factors.json); every factor's evidence, with URLs
and dates, lives in [impact-sources.json](impact-sources.json), which we track
for updates. The UI displays the factor-table version.

## Water: two parts, and shown at scale

Most headline "AI water" figures count only *onsite* cooling (~0.3 mL for a
short query). That understates it: the water used to *generate the electricity*
is comparable or larger. Drippy counts both.

The simple rule for what counts as "used": **water taken out of the local
water cycle (evaporated) is used.** Water that is drawn and returned is a
later complexity we are not counting yet. That maps to **consumptive**
(evaporative) water, onsite and offsite, and it avoids the larger withdrawal
figures some reports use. Total ≈ 2.35 mL/Wh.

A single query is a fraction of a millilitre, which is meaningless to a person.
So water will be shown only **at scale and once we are confident in it**: your
week or month of AI expressed in litres, with a human comparison (cups of
coffee, a shower of N minutes), never as a fake-precise per-query droplet.
Offsite grid-water intensity is the biggest lever here and is tracked yearly.

## Known limitations

- **Cache-read energy is the dominant term for agentic use.** A heavy Claude
  Code session re-reads hundreds of thousands of cached tokens per turn, so
  `cacheReadEnergyRatio` drives the total. It is now corroborated by two
  independent lines (the cache-read price ratio and a measured 85–95% cache-hit
  energy saving), which converge on 0.005. A direct energy measurement would
  still tighten it further, so it stays on the watch list.
- **Byte-based token estimates** (Claude Desktop and web) are approximate;
  they'll be replaced with exact counts as the browser extension (L2) lands.
  The Claude Code path is already exact.
- **Model tier is invisible on the estimated path**, so a Haiku token and an
  Opus token are priced the same there. The exact (Claude Code) path reads the
  real model per message.
- **Grid and water are single global figures**, not yet datacentre-region- or
  time-of-day-aware.
- **Anthropic only** for now, per the product's Claude-first roadmap.

## What the day's data shows so far

Interactive chat is cheap (about 0.5 Wh per exchange, similar to published
medians). Agentic coding sessions are 10 to 30 times heavier per minute,
dominated by re-sent context, visible in Drippy as `in` tokens dwarfing
`out`. Making that difference visible is the point.

## Contributing corrections

Factor changes bump the version and cite a source in
`impact-factors.json` → `sources`. Disagreements about values are welcome:
bring data, we'll ship the revision.
