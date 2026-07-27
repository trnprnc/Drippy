// Work-session awareness.
//
// The raw network signal (a flow to Anthropic) stops and starts between the
// individual API calls of an agentic task — while a tool runs, while the model
// thinks — so "is a request in flight" flickers on and off during one piece of
// work. That makes "no glow" an unreliable "it's finished".
//
// WorkSession collapses that into one steady state: any activity (re)starts it;
// it stays "working" until things have been quiet for `settleMs`; then it
// settles exactly once. The caller keeps the glow lit while it is working, and
// acts on `settled` — the honest "Claude has stopped" moment, whether the task
// finished or is blocked waiting on you.
//
// Timers/clock are injectable so the behaviour can be tested without real time.

const { EventEmitter } = require('events');

class WorkSession extends EventEmitter {
  constructor({ settleMs = 30000, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout, now = Date.now } = {}) {
    super();
    this.settleMs = settleMs;
    this._setTimeout = st;
    this._clearTimeout = ct;
    this._now = now;
    this.working = false;
    this.startedAt = 0;
    this.lastAt = 0;
    this.requests = 0;
    this.timer = null;
  }

  // Register AI activity. `request: true` means a distinct API call began (used
  // to tell a real task from a one-shot reply); other signals just keep the
  // session alive across a gap.
  activity({ request = false } = {}) {
    const t = this._now();
    this.lastAt = t;
    if (!this.working) {
      this.working = true;
      this.startedAt = t;
      this.requests = 0;
      this.emit('start', { at: t });
    }
    if (request) this.requests += 1;
    if (this.timer) this._clearTimeout(this.timer);
    this.timer = this._setTimeout(() => this._settle(), this.settleMs);
  }

  _settle() {
    if (!this.working) return;
    const durationMs = this.lastAt - this.startedAt;
    const requests = this.requests;
    this.working = false;
    this.timer = null;
    this.emit('settled', { durationMs, requests });
  }

  isWorking() {
    return this.working;
  }

  // Give up any pending timer (app quit / teardown).
  dispose() {
    if (this.timer) this._clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = WorkSession;
