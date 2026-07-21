// Notices: Drippy pointing at what his own meters show. Transparency only
// (product decision, 2026-07-20): every notice is grounded in a measured
// signal, says WHY it fired, and its button does the chore part (copy the
// remedy, open the right window). Anything coaching-shaped — writing style,
// prompt craft, wellbeing — was removed; Drippy reports, he does not advise
// on how to live.
//
// Outcomes (shown / acted / dismissed) are logged locally; dismissals
// stretch cooldowns rather than retiring a notice.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MIN_GAP_MS = 90 * 1000; // one visible notice at a time, not a stampede
const H = 3600 * 1000;

// Action kinds the main process knows how to perform:
//   copy (payload → clipboard) · open-trends · open-feed
const COPY = (label, payload) => ({ label, kind: 'copy', payload });

const FRESH_BRIEF = 'Fresh start. Context in two lines:\n1. \n2. \nTask: ';

// --- the catalogue --------------------------------------------------------
// when(sig, ev) runs against a signals snapshot plus an optional event.
// why(sig, ev) returns the one-line reason shown on the card.
// families: usage | guard | onboarding
const CATALOGUE = [
  // USAGE — what the meters actually show
  {
    id: 'batch-small', family: 'usage', cooldown: 8 * H,
    text: 'Ten small requests cost more than one combined one. Batching them into a single ask would shrink this.',
    why: (s) => `${s.daily.requests} requests today, mostly short answers`,
    action: COPY('Copy batch template', 'Several small questions at once; answer each briefly:\n1. \n2. \n3. '),
    when: (s) => s.daily.requests >= 10 && s.avgOutTokens > 0 && s.avgOutTokens < 150,
  },
  {
    id: 'right-size', family: 'usage', cooldown: 12 * H,
    text: 'These are small tasks on a big model. A smaller model would do them at a fraction of the energy and cost.',
    why: (s) => `${s.smallOutputStreak} short answers in a row from ${s.lastModel || 'Opus'}`,
    action: COPY("Copy '/model sonnet'", '/model sonnet'),
    when: (s) => /opus/.test(s.lastModel || '') && s.smallOutputStreak >= 5,
  },
  {
    id: 'idle-agent', family: 'usage', cooldown: 2 * H,
    text: 'An agent has been drawing energy solo for half an hour. Worth a glance that it is still on task.',
    why: (s) => `background AI running solo for ${Math.round(s.bgSoloMin)} minutes`,
    action: { label: 'Open usage trends', kind: 'open-trends' },
    when: (s) => s.bgSoloMin > 30,
  },
  {
    id: 'heavy-day', family: 'usage', cooldown: 20 * H,
    text: 'A heavier AI day than most; the trends window has the tally.',
    why: (s) => `roughly ${Math.round(s.daily.wh)} Wh so far today`,
    action: { label: 'Open usage trends', kind: 'open-trends' },
    when: (s) => s.daily.wh > 40,
  },
  {
    id: 'context-resend', family: 'usage', cooldown: 4 * H,
    text: 'You have re-sent a novel of context this hour. A fresh chat with just the relevant bits would be lighter.',
    why: (s) => `${Math.round(s.exactInput1h / 1000)}k tokens sent in the last hour`,
    action: COPY('Copy fresh-start brief', FRESH_BRIEF),
    when: (s) => s.exactInput1h > 600000,
  },

  // ONBOARDING — Drippy explains himself, in flow, once each
  {
    id: 'hover-hint', family: 'onboarding', once: true,
    text: 'That violet flash was me catching something. Hovering during one shows what I found and why.',
    why: () => 'your first privacy warning just cleared',
    when: (s, ev) => ev?.type === 'warning-cleared',
  },
  {
    id: 'trends-hint', family: 'onboarding', once: true,
    text: 'Three days of history now; a click on me opens usage trends, where the AI time goes.',
    why: () => 'three days of history collected',
    action: { label: 'Open usage trends', kind: 'open-trends' },
    when: (s) => s.daysOfHistory >= 3,
  },
  // GUARD-ADJACENT — habits that stop the next leak
  {
    id: 'placeholder-habit', family: 'guard', cooldown: 7 * 24 * H,
    text: 'Second near-miss with a key this week. Keep YOUR_KEY_HERE handy and paste that instead.',
    why: (s) => `${s.criticalsThisWeek} critical warnings this week`,
    action: COPY('Copy YOUR_KEY_HERE', 'YOUR_KEY_HERE'),
    when: (s) => s.criticalsThisWeek >= 2,
  },
  {
    id: 'rotate-check', family: 'guard', cooldown: 20 * H,
    text: 'About yesterday’s key: if it might have been sent anywhere, rotating it closes the risk.',
    why: () => "yesterday's critical warning",
    when: (s) => s.hoursSinceCritical > 12 && s.hoursSinceCritical < 36,
  },
  {
    id: 'clipboard-hygiene', family: 'guard', cooldown: 7 * 24 * H,
    text: 'Cleared. A habit worth keeping: copy secrets last and paste them first, so they sit on the clipboard for seconds, not minutes.',
    why: () => 'clipboard cleared just now',
    when: (s, ev) => ev?.type === 'critical-cleared-button',
  },
];

class SuggestionEngine extends EventEmitter {
  constructor({ stateDir, signals }) {
    super();
    this.file = path.join(stateDir, 'suggestions-state.json');
    this.signals = signals; // () => snapshot
    this.state = { nudges: {}, lastShownAt: 0, totalShown: 0, feed: [] };
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

  // Dismissals stretch the cooldown rather than retiring the notice: context
  // changes, so nothing is forever, but duds get quieter.
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

    let why = null;
    let action = null;
    try {
      why = pick.why ? pick.why(s, ev) : null;
      action = typeof pick.action === 'function' ? pick.action(s, ev) : pick.action || null;
    } catch {}

    this.state.feed.unshift({ id: pick.id, family: pick.family, text: pick.text, why, at: now, outcome: null });
    this.state.feed = this.state.feed.slice(0, 100);
    this.save();
    this.emit('suggest', { id: pick.id, family: pick.family, text: pick.text, why, action });
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
