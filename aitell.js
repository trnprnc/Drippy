// On-device AI-tell detector: pure rules, no AI, no network. Scores text for
// the fingerprints of machine writing so Drippy can nudge a human voice back
// in before the text travels. The text never leaves this module; only a
// score and signal ids survive (same doctrine as pii.js).
//
// Precision over recall: firing on genuinely human text costs trust, so the
// threshold requires either one strong signal plus support, or several weak
// ones together.

const TELL_PHRASES = [
  /i hope this (email )?finds you well/i,
  /in today'?s fast-paced (world|environment)/i,
  /it'?s (important|worth) (to note|noting) that/i,
  /i trust this (helps|is helpful)/i,
  /delve (into|deeper)/i,
  /in the ever-evolving/i,
  /unlock (the (full )?potential|new possibilities)/i,
  /game-?chang(er|ing)/i,
  /seamless(ly)? integrat/i,
  /elevate your/i,
  /navigat(e|ing) the complexit/i,
  /at the end of the day,/i,
  /as an ai/i,
];

const HEDGES = /\b(generally|typically|it is worth noting|note that|in most cases|broadly speaking)\b/gi;

function sentenceLengths(text) {
  return text
    .split(/[.!?]+\s/)
    .map((s) => s.trim().split(/\s+/).length)
    .filter((n) => n >= 4);
}

// Returns { score, signals: [ids strongest-first] }; fires at score >= 3.
function scanAiTell(text) {
  if (!text || text.length < 200) return { score: 0, signals: [] };
  const signals = [];
  let score = 0;

  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes >= 2) {
    score += 2;
    signals.push('emdash');
  } else if (emDashes === 1) {
    score += 1;
    signals.push('emdash');
  }

  let phraseHits = 0;
  for (const re of TELL_PHRASES) if (re.test(text)) phraseHits += 1;
  if (phraseHits > 0) {
    score += Math.min(3, phraseHits + 1);
    signals.push('phrase');
  }

  const lens = sentenceLengths(text);
  if (lens.length >= 6) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    if (mean > 8 && sd / mean < 0.28) {
      score += 1;
      signals.push('rhythm');
    }
  }

  const bullets = text.split('\n').filter((l) => /^\s*[-*•]\s+\S/.test(l));
  if (bullets.length >= 4) {
    const bl = bullets.map((b) => b.length);
    const bMean = bl.reduce((a, b) => a + b, 0) / bl.length;
    const bSd = Math.sqrt(bl.reduce((a, b) => a + (b - bMean) ** 2, 0) / bl.length);
    if (bSd / bMean < 0.22) {
      score += 1;
      signals.push('bullets');
    }
  }

  const hedges = (text.match(HEDGES) || []).length;
  if (hedges >= 3) {
    score += 1;
    signals.push('hedges');
  }

  if (/not (just|only|merely) [^.\n]{3,60}, but/i.test(text)) {
    score += 1;
    signals.push('notjust');
  }

  return { score, signals };
}

module.exports = { scanAiTell };
