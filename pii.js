// On-device privacy concerns catalogue: pure functions, no AI, no network.
// scanText() returns concern descriptors (id, label, severity); the matched
// text never leaves this module and is never stored or logged.
//
// Written for builders with limited development experience: every
// recommendation explains the danger in plain English. False positives
// erode trust, so rules favour precision over recall.
//
// severity: 'critical' = grants access to accounts/systems/money
//           'high'     = financial or government identity data
//           'medium'   = personal contact details

// Shared building blocks for the third-party detectors.
const NAME_PAIR = /\b[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}\b/;
const FULL_DATE = /\b(?:0?[1-9]|[12]\d|3[01])[/. -](?:0?[1-9]|1[0-2])[/. -](?:19|20)\d\d\b/;
const NHS_NUMBER = /\bNHS\s*(?:no\.?|number)?\s*[:#]?\s*\d{3}[ -]?\d{3}[ -]?\d{4}\b/i;
const CLINICAL_RE = /\b(?:diagnos(?:is|ed|es)|prescrib(?:ed|es|e)|medications?|symptoms?|treatment plan|clinical notes?|mental health)\b/i;
const HR_CONTEXT = /\b(?:appraisals?|performance review|disciplinary|sick leave|absence record|probation review)\b/i;
// "Emma Wilson: A*" / "Jacob Miles - 68%" — a name marked with a grade.
const GRADE_LINE = /\b[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?\s*[:\-–]\s*(?:A\*?|[B-FU]|\d{1,3}\s*%)(?![A-Za-z*%])/g;

const CONCERNS = [
  // --- credentials & secrets (critical) --------------------------------
  {
    id: 'anthropic-key',
    label: 'Anthropic API key',
    severity: 'critical',
    test: (t) => /\bsk-ant-[A-Za-z0-9_-]{8,}/.test(t),
    recommend:
      'This key lets anyone spend on your Anthropic account. Remove it, and rotate the key at console.anthropic.com if it may have been sent.',
  },
  {
    id: 'openai-key',
    label: 'OpenAI API key',
    severity: 'critical',
    test: (t) => /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/.test(t),
    recommend:
      'This key lets anyone spend on your OpenAI account. Remove it and rotate it at platform.openai.com.',
  },
  {
    id: 'github-token',
    label: 'GitHub token',
    severity: 'critical',
    test: (t) => /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(t),
    recommend:
      'This token can read and change your repositories. Remove it, then revoke it at github.com → Settings → Developer settings.',
  },
  {
    id: 'aws-key',
    label: 'AWS access key',
    severity: 'critical',
    test: (t) => /\bAKIA[0-9A-Z]{16}\b/.test(t) || /\baws_secret_access_key\b/i.test(t),
    recommend:
      'AWS keys can run up real bills fast if leaked. Remove them and rotate the key in the AWS IAM console.',
  },
  {
    id: 'stripe-key',
    label: 'Stripe key',
    severity: 'critical',
    test: (t) => /\b[rs]k_live_[A-Za-z0-9]{16,}\b/.test(t),
    recommend:
      'A live Stripe key can move real money. Remove it and roll the key in the Stripe dashboard immediately.',
  },
  {
    id: 'slack-token',
    label: 'Slack token',
    severity: 'critical',
    test: (t) => /\bxox[abpsr]-[A-Za-z0-9-]{10,}\b/.test(t),
    recommend: 'This token can read your workspace messages. Remove it and revoke it in Slack admin settings.',
  },
  {
    id: 'google-key',
    label: 'Google API key',
    severity: 'critical',
    test: (t) => /\bAIza[A-Za-z0-9_-]{30,}\b/.test(t),
    recommend: 'Remove it and restrict or regenerate the key in Google Cloud console.',
  },
  {
    id: 'private-key',
    label: 'private key file',
    severity: 'critical',
    test: (t) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t),
    recommend:
      'A private key is the master copy of an identity. Never share it with any service. Remove it and generate a new key pair if it was sent.',
  },
  {
    id: 'db-connection',
    label: 'database connection string',
    severity: 'critical',
    test: (t) => /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@]+:[^\s@]+@\S+/i.test(t),
    recommend:
      'This URL contains your database password, and anyone who has it can read or delete your data. Remove it and change the database password (for example in your Neon or Supabase dashboard).',
  },
  {
    id: 'jwt',
    label: 'session token (JWT)',
    severity: 'critical',
    test: (t) => /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(t),
    recommend:
      'This token can impersonate a logged-in user until it expires. Remove it; if it came from a real account, sign that account out everywhere.',
  },
  {
    id: 'bearer-token',
    label: 'bearer token',
    severity: 'critical',
    test: (t) => /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/.test(t),
    recommend: 'Authorization headers grant account access. Replace the token with <TOKEN> before sharing the request.',
  },
  {
    id: 'secret-assignment',
    label: 'password or secret in config',
    severity: 'critical',
    test: (t) =>
      /\b\w*(?:key|secret|token|passwd|password)\b\s*[:=]\s*["']?(?=[^\s"']*\d)[A-Za-z0-9_.\-]{8,}/i.test(t),
    recommend:
      "This looks like a line from a .env or config file. Secrets belong in environment variables, not in chats. Paste the code around the secret and replace the value with a placeholder like YOUR_KEY_HERE.",
  },
  // --- financial & government identity (high) --------------------------
  {
    id: 'card-number',
    label: 'card number',
    severity: 'high',
    test: (t) => hasCardNumber(t),
    recommend: 'Never share card numbers with an AI service. Remove it before sending.',
  },
  {
    id: 'iban',
    label: 'IBAN',
    severity: 'high',
    test: (t) => /\b[A-Z]{2}\d{2}\s?[A-Z0-9]{4}(?:\s?[A-Z0-9]{4}){2,7}\b/.test(t),
    recommend: 'Bank details should never be shared with an AI service. Remove them before sending.',
  },
  {
    id: 'uk-bank',
    label: 'UK bank details',
    severity: 'high',
    test: (t) => /sort\s*code/i.test(t) && /\b\d{2}[- ]?\d{2}[- ]?\d{2}\b/.test(t),
    recommend: 'Sort code and account number together identify your bank account. Remove them before sending.',
  },
  {
    id: 'uk-nino',
    label: 'National Insurance number',
    severity: 'high',
    test: (t) => /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/.test(t),
    recommend: 'Government IDs should never leave your machine. Remove it before sending.',
  },
  {
    id: 'ssn',
    label: 'SSN',
    severity: 'high',
    test: (t) => /\b\d{3}-\d{2}-\d{4}\b/.test(t),
    recommend: 'Government IDs should never leave your machine. Remove it before sending.',
  },
  // --- personal data about OTHER people (third-party breaches) ----------
  // A patient's details, a class of children's grades, a colleague's
  // appraisal: identifiable data about someone who is not the user, caught
  // at the point of entry, before Send. Rules are anchored: a role word or
  // record structure PLUS an identifier must co-occur; a capitalised name
  // alone never fires.
  {
    id: 'third-party-health',
    label: 'health details about a person',
    severity: 'high',
    test: (t) => {
      if (NHS_NUMBER.test(t)) return true;
      const clinical = CLINICAL_RE.test(t);
      const patient = /\bpatients?\b/i.test(t);
      const dobish = /\b(?:dob|date of birth|born)\b/i.test(t) && FULL_DATE.test(t);
      return (patient && clinical && NAME_PAIR.test(t)) || (patient && dobish) || (clinical && dobish && NAME_PAIR.test(t));
    },
    recommend:
      'This looks like health information about an identifiable person: special-category data. Remove the identifying details (name, date of birth, NHS number); the clinical question usually works without them.',
  },
  {
    id: 'childrens-data',
    label: 'information about children',
    severity: 'high',
    test: (t) => {
      const gradeLines = (t.match(GRADE_LINE) || []).length;
      if (gradeLines >= 3) return true;
      const ctx = /\b(?:pupils?|class list|school report|safeguarding)\b/i.test(t) || /\byear\s+(?:[1-9]|1[0-3])\b/i.test(t);
      const dobish = /\b(?:dob|date of birth|born)\b/i.test(t) && FULL_DATE.test(t);
      return ctx && (gradeLines >= 1 || (NAME_PAIR.test(t) && dobish));
    },
    recommend:
      'This looks like information about identifiable children. Initials or anonymised ids work just as well, and the question stays answerable.',
  },
  {
    id: 'bulk-personal-records',
    label: 'a list of personal records',
    severity: 'high',
    test: (t) => {
      const names = new Set(t.match(new RegExp(NAME_PAIR.source, 'g')) || []);
      if (names.size < 3) return false;
      const ids =
        (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || []).length +
        (t.match(/(?:\+44\s?\d{4}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g) || []).length +
        (t.match(new RegExp(FULL_DATE.source, 'g')) || []).length +
        (t.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g) || []).length;
      return ids >= 3;
    },
    recommend:
      "This looks like several people's personal records. Aggregate or anonymise before sending; the pattern usually matters more than the identities.",
  },
  {
    id: 'hr-record',
    label: 'HR details about a person',
    severity: 'high',
    test: (t) => {
      if (!HR_CONTEXT.test(t)) return false;
      // The name must exist apart from the context phrase itself
      // ("Performance Review" is a capitalised pair too).
      return NAME_PAIR.test(t.replace(new RegExp(HR_CONTEXT.source, 'gi'), ''));
    },
    recommend:
      'This looks like HR information about an identifiable person. A role name or initials usually works just as well.',
  },
  // --- personal contact details (medium) --------------------------------
  {
    id: 'email',
    label: 'email address',
    severity: 'medium',
    test: (t) => {
      // skip user:password@host segments of connection URLs
      const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
      let m;
      while ((m = re.exec(t))) {
        const before = t[m.index - 1];
        if (before !== ':' && before !== '/') return true;
      }
      return false;
    },
    recommend:
      'Remove it unless the model truly needs it. Text sent to AI services can persist in provider logs. A placeholder such as user@example.com usually works just as well.',
  },
  {
    id: 'phone',
    label: 'phone number',
    severity: 'medium',
    test: (t) =>
      /(?:\+44\s?\d{4}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b|\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{2,4}\b/.test(t),
    recommend: 'Consider a placeholder unless the number itself matters to the request.',
  },
  {
    id: 'dob',
    label: 'date of birth',
    severity: 'medium',
    test: (t) =>
      /\b(?:dob|date of birth|born)\b/i.test(t) && /\b(?:0?[1-9]|[12]\d|3[01])[/. -](?:0?[1-9]|1[0-2])[/. -](?:19|20)\d\d\b/.test(t),
    recommend: 'Birth dates are identity-theft building blocks. Remove it unless it is genuinely needed.',
  },
];

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2 };

// Risk tier drives how loudly Drippy reacts (see METHODOLOGY / the risk
// hierarchy). 1 = critical: real or irreversible harm (credentials,
// payment, government IDs, and identifiable data about OTHER people:
// health, children, bulk records) — full alarm + badge. 2 = caution:
// privacy-sensitive but low-to-moderate (phone, date of birth, a single
// HR record) — violet, no badge. 3 = low: minimal risk, e.g. your own
// email, which Claude already has — noted for trends but no warning.
const TIERS = {
  'anthropic-key': 1, 'openai-key': 1, 'github-token': 1, 'aws-key': 1, 'stripe-key': 1,
  'slack-token': 1, 'google-key': 1, 'private-key': 1, 'db-connection': 1, 'jwt': 1,
  'bearer-token': 1, 'secret-assignment': 1,
  'card-number': 1, 'iban': 1, 'uk-bank': 1, 'uk-nino': 1, 'ssn': 1,
  'third-party-health': 1, 'childrens-data': 1, 'bulk-personal-records': 1,
  'hr-record': 2,
  'phone': 2, 'dob': 2,
  'email': 3,
};

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

// Returns matched concerns sorted highest-risk first:
// [{id, label, severity, tier}]
function scanText(text) {
  if (!text || text.length < 6) return [];
  const found = [];
  for (const c of CONCERNS) {
    try {
      if (c.test(text)) found.push({ id: c.id, label: c.label, severity: c.severity, tier: TIERS[c.id] ?? 2 });
    } catch {}
  }
  return found.sort((a, b) => a.tier - b.tier || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function recommendationFor(id) {
  const c = CONCERNS.find((x) => x.id === id);
  return c ? c.recommend : 'Review it before sending.';
}

module.exports = { scanText, recommendationFor, CONCERNS };
