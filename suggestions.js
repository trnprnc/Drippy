// The suggestion engine: Drippy as a voice of reason, built as a better
// Clippy. Abundance doctrine (product decision, 2026-07-16): no daily caps;
// maximise the number of suggestions that pass the accuracy gate; feedback
// tunes ranking and cooldowns, nothing retires forever.
//
// Every suggestion: one breath long, never modal, never does the work FOR
// you, but the button does the chore part (copy the better prompt, start
// the break, open the right window). Each card also says WHY it fired, so
// nothing feels random. Outcomes (shown / acted / dismissed) are logged
// locally so the catalogue earns its place with data.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MIN_GAP_MS = 90 * 1000; // one visible suggestion at a time, not a stampede
const H = 3600 * 1000;

// Action kinds the main process knows how to perform:
//   copy (payload → clipboard) · break (5-minute timer) · footprint ·
//   open-trends · open-feed. 'reveal' expands detail inside the bubble.
const COPY = (label, payload) => ({ label, kind: 'copy', payload });
const BREAK = { label: 'Take 5 minutes now', kind: 'break' };

const TELL_DETAIL = {
  emdash: 'em dashes mid-sentence, the classic tell',
  phrase: "stock AI phrases ('delve', 'moreover', 'it is worth noting')",
  rhythm: 'sentences of near-identical length, no human rhythm',
  bullets: 'perfectly parallel bullet points',
  hedges: 'stacked hedges (may, might, could) with no view taken',
};
const tellReveal = (ev) => ({
  label: 'What gave it away?',
  kind: 'reveal',
  payload: 'Spotted:\n' + (ev?.signals || []).map((s) => '· ' + (TELL_DETAIL[s] || s)).join('\n'),
});

const FRESH_BRIEF = 'Fresh start. Context in two lines:\n1. \n2. \nTask: ';

// --- the launch catalogue -------------------------------------------------
// when(sig, ev) runs against a signals snapshot plus an optional event.
// why(sig, ev) returns the one-line reason shown on the card.
// families: authenticity | practice | wellbeing | usage | onboarding | guard
const CATALOGUE = [
  // AUTHENTICITY — triggered by AI-tell verdicts on text copied out of Claude
  {
    id: 'tell-emdash', family: 'authenticity', cooldown: 0.5 * H,
    text: 'Em dashes are an AI fingerprint now. Swap them for full stops and add a line only you would write.',
    why: () => 'AI patterns in text you just copied out of Claude',
    action: (s, ev) => tellReveal(ev),
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('emdash'),
  },
  {
    id: 'tell-phrase', family: 'authenticity', cooldown: 0.75 * H,
    text: 'That phrasing is a known AI tell. Say it the way you would say it out loud.',
    why: () => 'AI patterns in text you just copied out of Claude',
    action: (s, ev) => tellReveal(ev),
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('phrase'),
  },
  {
    id: 'tell-rhythm', family: 'authenticity', cooldown: 1 * H,
    text: 'Every sentence is nearly the same length. Human writing has rhythm; vary a couple.',
    why: () => 'AI patterns in text you just copied out of Claude',
    action: (s, ev) => tellReveal(ev),
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('rhythm'),
  },
  {
    id: 'tell-bullets', family: 'authenticity', cooldown: 2 * H,
    text: 'Perfectly matching bullets read as generated. Rough one up with a real example.',
    why: () => 'AI patterns in text you just copied out of Claude',
    action: (s, ev) => tellReveal(ev),
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('bullets'),
  },
  {
    id: 'tell-hedges', family: 'authenticity', cooldown: 2 * H,
    text: 'Three hedges in one passage. Cut two and it sounds like a person with a view.',
    why: () => 'AI patterns in text you just copied out of Claude',
    action: (s, ev) => tellReveal(ev),
    when: (s, ev) => ev?.type === 'aitell' && ev.signals.includes('hedges'),
  },

  // PRACTICE — better use of the AI you already have
  {
    id: 'ask-critique', family: 'practice', cooldown: 8 * H,
    text: 'AI loves to agree with you. Ask it to attack the idea instead; the pushback is the value.',
    why: (s) => `${s.fgReq30m} requests in the last 30 minutes`,
    action: COPY('Copy critique prompt', 'Attack this idea. What breaks first, and why? Be specific and blunt; no praise, no hedging.'),
    when: (s) => s.fgReq30m >= 8,
  },
  {
    id: 'notepad', family: 'practice', cooldown: 8 * H,
    text: 'Lots of threads open at once. Sixty seconds with a notepad may untangle more than another prompt.',
    why: (s) => `${s.fgReq20m} requests in 20 minutes`,
    when: (s) => s.fgReq20m >= 12,
  },
  {
    id: 'one-clear-question', family: 'practice', cooldown: 4 * H,
    text: 'Rapid re-prompts usually mean the question is not clear yet. Write it once, properly, and send that.',
    why: (s) => `${s.rapidStreak} rapid re-prompts in a row`,
    action: COPY('Copy question template', 'What I am actually trying to do:\nWhat I have tried:\nWhere it fails:\nMy question, in one sentence: '),
    when: (s) => s.rapidStreak >= 4,
  },
  {
    id: 'fresh-chat', family: 'practice', cooldown: 6 * H,
    text: 'This chat is carrying a lot of history. A fresh one with a two-line brief will be sharper and lighter.',
    why: (s) => `about ${Math.round(s.lastCacheRead / 1000)}k tokens of history re-read every turn`,
    action: COPY('Copy fresh-start brief', FRESH_BRIEF),
    when: (s) => s.lastCacheRead > 300000,
  },
  {
    id: 'small-steps', family: 'practice', cooldown: 8 * H,
    text: 'Big asks drift. Break it into steps and check the first before asking for the second.',
    why: (s) => `one answer has been streaming for ${Math.max(3, Math.floor(s.fgStreamingSec / 60))} minutes`,
    action: COPY('Copy step-one prompt', 'Let us do this in steps. Do step 1 only, then stop; I will check it before we go on.\nStep 1: '),
    when: (s) => s.fgStreamingSec > 180,
  },
  {
    id: 'show-example', family: 'practice', cooldown: 24 * H, rotation: true,
    text: 'Show, do not tell: paste an example of what good looks like. One example beats three paragraphs of rules.',
    why: () => 'a fresh-session thought',
    action: COPY('Copy example prompt', 'Here is an example of what good looks like:\n<paste your example>\nMatch this shape, tone and quality.'),
  },
  {
    id: 'verify-figure', family: 'practice', cooldown: 24 * H, rotation: true,
    text: 'AI states invented numbers with total confidence. Check any figure before it travels.',
    why: () => 'a fresh-session thought',
    action: COPY('Copy source-check prompt', 'For every number and claim above: name your source, link it, and flag anything you are not certain of.'),
  },
  {
    id: 'own-decision', family: 'practice', cooldown: 24 * H, rotation: true,
    text: 'Let it draft options all day, but keep the choosing for yourself. The decision is the human part.',
    why: () => 'a fresh-session thought',
  },

  // WELLBEING — protect the human
  {
    id: 'late-break', family: 'wellbeing', cooldown: 12 * H,
    text: 'Late one. Claude will still be here after a stretch and a glass of water.',
    why: (s) => `${Math.round(s.presentContinuousMin)} minutes at it, and it is late`,
    action: BREAK,
    when: (s) => s.presentContinuousMin > 60 && (s.hour >= 22 || s.hour < 5),
  },
  {
    id: 'marathon', family: 'wellbeing', cooldown: 6 * H,
    text: 'Two hours deep. Five minutes away from the screen will beat the next five prompts.',
    why: (s) => `${Math.round(s.presentContinuousMin)} minutes without a break`,
    action: BREAK,
    when: (s) => s.presentContinuousMin > 120,
  },
  {
    id: 'morning-intent', family: 'wellbeing', cooldown: 20 * H,
    text: 'Before the first prompt: what would make today feel done? Aim the AI at that.',
    why: () => 'first prompt of the day',
    action: COPY('Copy intent line', 'Today feels done when: '),
    when: (s, ev) => ev?.type === 'session-start' && s.hour >= 5 && s.hour < 11 && s.daily.requests === 0,
  },
  {
    id: 'tired-leak', family: 'wellbeing', cooldown: 12 * H,
    text: 'Leaks happen when we are tired. Slow the copy-paste down this late.',
    why: () => 'a privacy near-miss, this late',
    action: BREAK,
    when: (s) => (s.hour >= 22 || s.hour < 5) && s.minSincePrivacy < 30,
  },

  // USAGE-CRAFT — what the meters actually show
  {
    id: 'batch-small', family: 'usage', cooldown: 8 * H,
    text: 'Ten tiny questions cost more than one good one. Batch the small stuff into a single ask.',
    why: (s) => `${s.daily.requests} requests today, mostly short answers`,
    action: COPY('Copy batch template', 'Several small questions at once; answer each briefly:\n1. \n2. \n3. '),
    when: (s) => s.daily.requests >= 10 && s.avgOutTokens > 0 && s.avgOutTokens < 150,
  },
  {
    id: 'right-size', family: 'usage', cooldown: 12 * H,
    text: 'Opus on small tasks is a sledgehammer on a picture hook. Haiku or Sonnet would do these fine.',
    why: (s) => `${s.smallOutputStreak} short answers in a row from ${s.lastModel || 'Opus'}`,
    action: COPY("Copy '/model sonnet'", '/model sonnet'),
    when: (s) => /opus/.test(s.lastModel || '') && s.smallOutputStreak >= 5,
  },
  {
    id: 'idle-agent', family: 'usage', cooldown: 2 * H,
    text: 'An agent has been running solo for half an hour. Worth a glance that it is still on task.',
    why: (s) => `background AI running solo for ${Math.round(s.bgSoloMin)} minutes`,
    action: { label: 'Open usage trends', kind: 'open-trends' },
    when: (s) => s.bgSoloMin > 30,
  },
  {
    id: 'heavy-day', family: 'usage', cooldown: 20 * H,
    text: 'Heavy AI day. Fine if it earned its keep; the footprint ring has the tally.',
    why: (s) => `roughly ${Math.round(s.daily.wh)} Wh so far today`,
    action: { label: 'Show my footprint ring', kind: 'footprint' },
    when: (s) => s.daily.wh > 40,
  },
  {
    id: 'context-resend', family: 'usage', cooldown: 4 * H,
    text: 'You have re-sent a novel of context this hour. Fresh chat, just the relevant bits.',
    why: (s) => `${Math.round(s.exactInput1h / 1000)}k tokens sent in the last hour`,
    action: COPY('Copy fresh-start brief', FRESH_BRIEF),
    when: (s) => s.exactInput1h > 600000,
  },

  // ONBOARDING — Drippy teaches itself, in flow, once each
  {
    id: 'hover-hint', family: 'onboarding', once: true,
    text: 'That violet flash was me catching something. Hover me during one to see what and why.',
    why: () => 'your first privacy warning just cleared',
    when: (s, ev) => ev?.type === 'warning-cleared',
  },
  {
    id: 'doze-hint', family: 'onboarding', once: true,
    text: 'When you are away a while I condense into a droplet to stay out of your way. The moment you need me, I plump back up.',
    why: () => 'you just woke me',
    when: (s, ev) => ev?.type === 'doze-wake',
  },
  {
    id: 'trends-hint', family: 'onboarding', once: true,
    text: "Three days of history now. 'Usage trends' in my menu shows where the AI time goes.",
    why: () => 'three days of history collected',
    action: { label: 'Open usage trends', kind: 'open-trends' },
    when: (s) => s.daysOfHistory >= 3,
  },
  {
    id: 'feed-hint', family: 'onboarding', once: true,
    text: "Everything I suggest lands in 'Suggestions' in my menu, so nothing is lost if you are heads-down.",
    why: () => 'a few suggestions in',
    action: { label: 'Open the feed', kind: 'open-feed' },
    when: (s) => s.totalShown >= 3,
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
    text: 'About yesterday’s key: if it might have been sent anywhere, rotate it. Two minutes now.',
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
