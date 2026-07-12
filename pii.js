// On-device PII rules engine — pure functions, no AI, no network.
// scanText() returns only CATEGORY names; the matched text never leaves
// this module and is never stored or logged.

const RULES = [
  {
    category: 'api key',
    re: /\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bap]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})\b/,
  },
  {
    category: 'email address',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  },
  {
    category: 'phone number',
    re: /(?:\+44\s?\d{4}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b|\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{2,4}\b/,
  },
  {
    category: 'national insurance number',
    re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/,
  },
  {
    category: 'iban',
    re: /\b[A-Z]{2}\d{2}\s?[A-Z0-9]{4}(?:\s?[A-Z0-9]{4}){2,7}\b/,
  },
  {
    category: 'ssn',
    re: /\b\d{3}-\d{2}-\d{4}\b/,
  },
];

function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function hasCardNumber(text) {
  const runs = text.match(/(?:\d[ -]?){13,19}/g);
  if (!runs) return false;
  return runs.some((run) => {
    const digits = run.replace(/[^\d]/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
  });
}

function scanText(text) {
  if (!text || text.length < 6) return [];
  const found = [];
  for (const rule of RULES) {
    if (rule.re.test(text)) found.push(rule.category);
  }
  if (hasCardNumber(text)) found.push('card number');
  return found;
}

module.exports = { scanText };
