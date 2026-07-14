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

## Current factors (v2026.07.2, provisional)

| Assumption | Value | Basis |
|---|---|---|
| `whPer1kOutputTokens` | 1.0 Wh | triangulated from Google's Gemini serving paper (0.24 Wh median prompt incl. overheads), Epoch AI (~0.3 Wh/GPT-4o query), OpenAI's stated 0.34 Wh average |
| `inputTokenEnergyRatio` | 0.1 | context processing is far cheaper per token than generation |
| `freshInputFraction` | 0.2 | share of uplink tokens genuinely recomputed vs. served from prompt cache |
| `gridGCo2PerKwh` | 350 g | world blended average; region-awareness planned |
| `waterMlPerWh` | 1.1 mL | consistent with Google's published 0.26 mL / 0.24 Wh |
| `wireBytesPerOutputToken` | 110 B | SSE envelope overhead; calibratable against measured token counts |
| `wireBytesPerInputToken` | 6 B | JSON-encoded text ≈ 4–5 chars/token + envelope |
| `uncertaintyBand` | ×⅓ … ×3 | shown wherever numbers appear |

The machine-readable source of truth is
[impact-factors.json](impact-factors.json); the UI displays its version.

## Known limitations

- **Byte-based token estimates** are approximate; they'll be calibrated
  against exact counts once the browser extension (L2 adapter) measures real
  token streams.
- **Model tier is invisible** at the network level, so a Haiku token and an
  Opus token are currently priced the same. Tier multipliers arrive with L2.
- **One flow can span several API calls** (agentic tools make back-to-back
  requests), so "requests" is a lower bound; byte totals remain correct.
- **Attribution ("yours" vs background)** is a timing heuristic until
  per-surface adapters exist.
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
