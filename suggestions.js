// The suggestion engine: Drippy as a voice of reason, built as a better
// Clippy. Abundance doctrine (product decision, 2026-07-16): no daily caps;
// maximise the number of suggestions that pass the accuracy gate; feedback
// tunes ranking and cooldowns, nothing retires forever.
//
// Every suggestion: one breath long, never modal, never does the work.
// Outcomes (shown / acted / dismissed) are logged locally so the catalogue
// earns its place with data.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MIN_GAP_MS = 90 * 1000; // one visible suggestion at a time, not a stampede
const H = 3600 * 1000;

// --- the launch catalogue -------------------------------------------------
// when(sig, ev) runs against a signals snapshot plus an optional event.
// families: authenticity | practice | wellbeing | usage | onboarding | guard
const CATALOGUE = [
  // AUTHENTICITY — triggered by AI-tell verdicts on text copied out of Claude
  {
    id: 'tell-emdash', family: 'authenticity', cooldown: 0.5 * H,
    text: 'Em dashes are an AI fingerprint now. Swap them for full stops and add a line only you would write.',
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('emdash'),
  },
  {
    id: 'tell-phrase', family: 'authenticity', cooldown: 0.75 * H,
    text: 'That phrasing is a known AI tell. Say it the way you would say it out loud.',
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('phrase'),
  },
  {
    id: 'tell-rhythm', family: 'authenticity', cooldown: 1 * H,
    text: 'Every sentence is nearly the same length. Human writing has rhythm; vary a couple.',
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('rhythm'),
  },
  {
    id: 'tell-bullets', family: 'authenticity', cooldown: 2 * H,
    text: 'Perfectly matching bullets read as generated. Rough one up with a real example.',
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('bullets'),
  },
  {
    id: 'tell-hedges', family: 'authenticity', cooldown: 2 * H,
    text: 'Three hedges in one passage. Cut two and it sounds like a person with a view.',
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('hedges'),
  },

  // PRACTICE — better use of the AI you already have
  {
    id: 'ask-critique', family: 'practice', cooldown: 8 * H,
    text: 'AI loves to agree with you. Ask it to attack the idea instead; the pushback is the value.',
    when: (s) => s.fgReq30m >= 8,
  },
  {
    id: 'notepad', family: 'practice', cooldown: 8 * H,
    text: 'Lots of threads open at once. Sixty seconds with a notepad may untangle more than another prompt.',
    when: (s) => s.fgReq20m >= 12,
  },
  {
    id: 'one-clear-question', family: 'practice', cooldown: 4 * H,
    text: 'Rapid re-prompts usually mean the question is not clear yet. Write it once, properly, and send that.',
    when: (s) => s.rapidStreak >= 4,
  },
  {
    id: 'fresh-chat', family: 'practice', cooldown: 6 * H,
    text: 'This chat is carrying a lot of history. A fresh one with a two-line brief will be sharper and lighter.',
    when: (s) => s.lastCacheRead > 300000,
  },
  {
    id: 'small-steps', family: 'practice', cooldown: 8 * H,
    text: 'Big asks drift. Break it into steps and check the first before asking for the second.',
    when: (s) => s.fgStreamingSec > 180,
  },
  {
    id: 'show-example', family: 'practice', cooldown: 24 * H, rotation: true,
    text: 'Show, do not tell: paste an example of what good looks like. One example beats three paragraphs of rules.',
  },
  {
    id: 'verify-figure', family: 'practice', cooldown: 24 * H, rotation: true,
    text: 'AI states invented numbers with total confidence. Check any figure before it travels.',
  },
  {
    id: 'own-decision', family: 'practice', cooldown: 24 * H, rotation: true,
    text: 'Let it draft options all day, but keep the choosing for yourself. The decision is the human part.',
  },
  {
    id: 'ask-sources', family: 'practice', cooldown: 24 * H, rotation: true,
    text: 'If the answer matters, ask for sources and actually open one.',
  },

  // WELLBEING — protect the human
  {
    id: 'late-break', family: 'wellbeing', cooldown: 12 * H,
    text: 'Late one. Claude will still be here after a stretch and a glass of water.',
    when: (s) => s.presentContinuousMin > 60 && (s.hour >= 22 || s.hour < 5),
  },
  {
    id: 'marathon', family: 'wellbeing', cooldown: 6 * H,
    text: 'Two hours deep. Five minutes away from the screen will beat the next five prompts.',
    when: (s) => s.presentContinuousMin > 120,
  },
  {
    id: 'morning-intent', family: 'wellbeing', cooldown: 20 * H,
    text: 'Before the first prompt: what would make today feel done? Aim the AI at that.',
    when: (s, ev) => ev?.type === 'session-start' && s.hour >= 5 && s.hour < 11 && s.daily.requests === 0,
  },
  {
    id: 'tired-leak', family: 'wellbeing', cooldown: 12 * H,
    text: 'Leaks happen when we are tired. Slow the copy-paste down this late.',
    when: (s) => (s.hour >= 22 || s.hour < 5) && s.minSincePrivacy < 30,
  },

  // USAGE-CRAFT — what the meters actually show
  {
    id: 'batch-small', family: 'usage', cooldown: 8 * H,
    text: 'Ten tiny questions cost more than one good one. Batch the small stuff into a single ask.',
    when: (s) => s.daily.requests >= 10 && s.avgOutTokens > 0 && s.avgOutTokens < 150,
  },
  {
    id: 'right-size', family: 'usage', cooldown: 12 * H,
    text: 'Opus on small tasks is a sledgehammer on a picture hook. Haiku or Sonnet would do these fine.',
    when: (s) => /opus/.test(s.lastModel || '') && s.smallOutputStreak >= 5,
  },
  {
    id: 'idle-agent', family: 'usage', cooldown: 2 * H,
    text: 'An agent has been running solo for half an hour. Worth a glance that it is still on task.',
    when: (s) => s.bgSoloMin > 30,
  },
  {
    id: 'heavy-day', family: 'usage', cooldown: 20 * H,
    text: 'Heavy AI day. Fine if it earned its keep; the footprint ring has the tally.',
    when: (s) => s.daily.wh > 40,
  },
  {
    id: 'context-resend', family: 'usage', cooldown: 4 * H,
    text: 'You have re-sent a novel of context this hour. Fresh chat, just the relevant bits.',
    when: (s) => s.exactInput1h > 600000,
  },

  // ONBOARDING — Drippy teaches itself, in flow, once each
  {
    id: 'hover-hint', family: 'onboarding', once: true,
    text: 'That violet flash was me catching something. Hover me during one to see what and why.',
    when: (s, ev) => ev?.type === 'warning-cleared',
  },
  {
    id: 'doze-hint', family: 'onboarding', once: true,
    text: 'I nap in the corner when you are away and bounce back when you work. That is the whole trick.',
    when: (s, ev) => ev?.type === 'doze-wake',
  },
  {
    id: 'trends-hint', family: 'onboarding', once: true,
    text: "Three days of history now. 'Usage trends' in my menu shows where the AI time goes.",
    when: (s) => s.daysOfHistory >= 3,
  },
  {
    id: 'feed-hint', family: 'onboarding', once: true,
    text: "Everything I suggest lands in 'Suggestions' in my menu, so nothing is lost if you are heads-down.",
    when: (s) => s.totalShown >= 3,
  },

  // GUARD-ADJACENT — habits that stop the next leak
  {
    id: 'placeholder-habit', family: 'guard', cooldown: 7 * 24 * H,
    text: 'Second near-miss with a key this week. Keep YOUR_KEY_HERE handy and paste that instead.',
    when: (s) => s.criticalsThisWeek >= 2,
  },
  {
    id: 'rotate-check', family: 'guard', cooldown: 20 * H,
    text: 'About yesterday’s key: if it might have been sent anywhere, rotate it. Two minutes now.',
    when: (s) => s.hoursSinceCritical > 12 && s.hoursSinceCritical < 36,
  },
  {
    id: 'clipboard-hygiene', family: 'guard', cooldown: 7 * 24 * H,
    text: 'Cleared. A habit worth keeping: copy secrets last and paste them first, so they sit on the clipboard for seconds, not minutes.',
    when: (s, ev) => ev?.type === 'critical-cleared-button',
  },
];

const ROTATION_GAP_MS = 3 * H; // at most one rotation tip per 3h, at session starts

class SuggestionEngine extends EventEmitter {
  constructor({ stateDir, signals }) {
    super();
    this.file = path.join(stateDir, 'suggestions-state.json');
    this.signals = signals; // () => snapshot
    this.state = { nudges: {}, lastShownAt: 0, lastRotationAt: 0, totalShown: 0, feed: [] };
    try {
      this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {}
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.state));
    } catch {}
  }

  nudgeState(id) {
    return (this.state.nudges[id] = this.state.nudges[id] || { shown: 0, acted: 0, dismissed: 0, lastAt: 0 });
  }

  // Dismissals stretch the cooldown rather than retiring the nudge: context
  // changes, so nothing is forever, but duds get quieter (abundance doctrine).
  effectiveCooldown(n, ns) {
    if (n.once) return ns.shown > 0 ? Infinity : 0;
    return (n.cooldown || 6 * H) * Math.pow(3, Math.min(4, ns.dismissed));
  }

  evaluate(ev = null) {
    const now = Date.now();
    if (now - this.state.lastShownAt < MIN_GAP_MS) return;
    const s = { ...this.signals(), totalShown: this.state.totalShown };

    let candidates = CATALOGUE.filter((n) => {
      const ns = this.nudgeState(n.id);
      if (now - ns.lastAt < this.effectiveCooldown(n, ns)) return false;
      if (n.rotation) return ev?.type === 'session-start' && now - this.state.lastRotationAt > ROTATION_GAP_MS;
      try {
        return n.when ? n.when(s, ev) : false;
      } catch {
        return false;
      }
    });
    if (!candidates.length) return;

    // Rank: least-dismissed first, then least-recently shown.
    candidates.sort((a, b) => {
      const A = this.nudgeState(a.id);
      const B = this.nudgeState(b.id);
      return A.dismissed - B.dismissed || A.lastAt - B.lastAt;
    });
    const pick = candidates[0];
    const ns = this.nudgeState(pick.id);
    ns.shown += 1;
    ns.lastAt = now;
    this.state.lastShownAt = now;
    this.state.totalShown += 1;
    if (pick.rotation) this.state.lastRotationAt = now;
    this.state.feed.unshift({ id: pick.id, family: pick.family, text: pick.text, at: now, outcome: null });
    this.state.feed = this.state.feed.slice(0, 100);
    this.save();
    this.emit('suggest', { id: pick.id, family: pick.family, text: pick.text });
  }

  outcome(id, kind) {
    const ns = this.nudgeState(id);
    if (kind === 'acted') ns.acted += 1;
    if (kind === 'dismissed') ns.dismissed += 1;
    const item = this.state.feed.find((f) => f.id === id && !f.outcome);
    if (item) item.outcome = kind;
    this.save();
    this.emit('outcome', { id, kind });
  }

  feed() {
    return this.state.feed.slice(0, 50);
  }
}

module.exports = { SuggestionEngine, CATALOGUE };
