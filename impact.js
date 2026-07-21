// Impact engine — pure arithmetic over a versioned factor table.
// No AI anywhere in this path, by design principle.

const factors = require('./impact-factors.json');

const A = factors.assumptions;

// Water has two comparable parts: onsite cooling (WUE) and the offsite water
// used to generate the electricity. Counting only onsite understates it by
// roughly half. See impact-sources.json (water-*).
const WATER_ML_PER_WH = A.waterOnsiteMlPerWh + A.waterOffsiteMlPerWh;

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
    waterMl: wh * WATER_ML_PER_WH,
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

function tierFor(model) {
  const m = (model || '').toLowerCase();
  const tiers = A.modelTiers || {};
  for (const key of Object.keys(tiers)) {
    if (key !== 'default' && m.includes(key)) return tiers[key];
  }
  return tiers.default ?? 1;
}

// API-rate value of EXACT usage (Claude Code transcripts only): what these
// tokens would cost at Anthropic's list prices. Not necessarily what the
// user pays (subscriptions differ) — it is shown as "at API rates".
function usdFromUsage({ model, inputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0, outputTokens = 0 }) {
  const P = factors.pricing;
  if (!P) return 0;
  const m = (model || '').toLowerCase();
  let rate = P.usdPerMtok.default;
  for (const key of Object.keys(P.usdPerMtok)) {
    if (key !== 'default' && m.includes(key)) {
      rate = P.usdPerMtok[key];
      break;
    }
  }
  return (
    (inputTokens * rate.in +
      cacheCreationTokens * rate.in * P.cacheWriteInputMultiplier +
      cacheReadTokens * rate.in * P.cacheReadInputMultiplier +
      outputTokens * rate.out) /
    1e6
  );
}

// Everyday equivalents so the numbers mean something at a glance.
// Conservative factors, cited in impact-factors.json (equivalents-2026).
function equivalents({ wh = 0, waterMl = 0, gco2 = 0 }) {
  const E = factors.equivalents || {};
  const fmt = (v) => (v >= 10 ? String(Math.round(v)) : v >= 1 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100));
  const parts = [];
  const phones = E.phoneChargeWh ? wh / E.phoneChargeWh : 0;
  if (phones >= 0.05) parts.push(`${fmt(phones)} phone charge${phones >= 1.95 ? 's' : ''}`);
  const glasses = E.glassMl ? waterMl / E.glassMl : 0;
  if (glasses >= 0.05) parts.push(`${fmt(glasses)} glass${glasses >= 1.95 ? 'es' : ''} of water`);
  const km = E.carGCo2PerKm ? gco2 / E.carGCo2PerKm : 0;
  if (km >= 0.01) parts.push(`${fmt(km)} km in a petrol car`);
  return parts.join(' · ');
}

// Exact accounting from a provider usage object (Claude Code transcripts).
// No estimation: fresh input, cache-creation and cache-read are priced
// separately, then scaled by the model tier.
//   fresh input + cache creation: full input processing energy
//   cache read: a small fraction (no recomputation, attention over cache)
//   output: full generation energy
function fromUsage({ model, inputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0, outputTokens = 0 }) {
  const tier = tierFor(model);
  const freshIn = inputTokens + cacheCreationTokens;
  const inputWh = (freshIn / 1000) * A.whPer1kOutputTokens * A.inputTokenEnergyRatio;
  const cacheWh = (cacheReadTokens / 1000) * A.whPer1kOutputTokens * A.cacheReadEnergyRatio;
  const outputWh = (outputTokens / 1000) * A.whPer1kOutputTokens;
  const wh = (inputWh + cacheWh + outputWh) * tier;
  return {
    model,
    tier,
    inputTokens: freshIn + cacheReadTokens, // total input, for display
    outputTokens,
    wh,
    gco2: (wh / 1000) * A.gridGCo2PerKwh,
    waterMl: wh * WATER_ML_PER_WH,
    usd: usdFromUsage({ model, inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens }),
    band: A.uncertaintyBand,
  };
}

module.exports = { fromBytes, fromUsage, impactOf, tokensFromBytes, tierFor, equivalents, version: factors.version };
