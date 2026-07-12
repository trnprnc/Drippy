# How Drippy estimates AI impact

Honest numbers about AI's footprint don't fully exist yet: no provider
publishes per-request figures for Claude. Drippy's answer is to estimate
openly rather than not at all. Every number carries an uncertainty band
(currently **±3×**), every assumption lives in a versioned, source-cited
factor table, and revisions are expected as provider and community data
improves. If you can improve a factor, we want the correction.

## The pipeline

```
wire bytes  →  tokens  →  energy (Wh)  →  carbon (gCO₂e) + water (mL)
```

1. **Bytes.** The network monitor measures encrypted traffic volume to
   Anthropic per request: downlink (the streamed response) and uplink (your
   prompt plus re-sent conversation context). No content is read.
2. **Tokens.** Streaming responses have near-constant wire overhead per
   token, so `bytes ÷ wireBytesPerOutputToken` estimates output tokens;
   uplink bytes similarly estimate input tokens.
3. **Energy.** Output tokens are priced at `whPer1kOutputTokens`. Input
   tokens cost `inputTokenEnergyRatio` (about 10%) of that, and only
   `freshInputFraction` (about 20%) of them are charged at all, because
   agentic clients re-send context that providers serve from prompt cache at
   a small fraction of full-reprocessing cost.
4. **Carbon and water.** Energy × world-average grid intensity
   (`gridGCo2PerKwh`) and datacentre water use (`waterMlPerWh`). Both will
   become region-aware.

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
