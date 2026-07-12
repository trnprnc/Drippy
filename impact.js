// Impact engine — pure arithmetic over a versioned factor table.
// No AI anywhere in this path, by design principle.

const factors = require('./impact-factors.json');

const A = factors.assumptions;

// Wire bytes of an SSE response stream are roughly proportional to output
// tokens (JSON envelope overhead per chunk is near-constant); the factor is
// calibratable against measured token counts from L2 adapters later.
function tokensFromBytes(bytesIn) {
  return Math.max(0, Math.round(bytesIn / A.wireBytesPerOutputToken));
}

function impactOf(outputTokens, inputTokens = null) {
  const tin = inputTokens == null ? outputTokens * A.inputTokensPerOutputToken : inputTokens;
  // Input side: cheaper per token than generation (inputTokenEnergyRatio),
  // and mostly served from prompt cache in agentic clients that re-send
  // context every call (freshInputFraction) — see factor table sources.
  const wh =
    (outputTokens / 1000) * A.whPer1kOutputTokens +
    (tin / 1000) * A.whPer1kOutputTokens * A.inputTokenEnergyRatio * A.freshInputFraction;
  return {
    wh,
    gco2: (wh / 1000) * A.gridGCo2PerKwh,
    waterMl: wh * A.waterMlPerWh,
    band: A.uncertaintyBand,
  };
}

// Uplink bytes carry the prompt PLUS the full conversation context, which
// the model genuinely reprocesses each turn — so bytesOut is the honest
// input-token signal. Falls back to a ratio when the uplink is tiny.
function fromBytes(bytesIn, bytesOut = 0) {
  const outputTokens = tokensFromBytes(bytesIn);
  const inputTokens =
    bytesOut > 2000
      ? Math.round(bytesOut / A.wireBytesPerInputToken)
      : Math.round(outputTokens * A.inputTokensPerOutputToken);
  return { outputTokens, inputTokens, ...impactOf(outputTokens, inputTokens) };
}

module.exports = { fromBytes, impactOf, tokensFromBytes, version: factors.version };
