// Claude Code usage adapter: exact, provider-grade token accounting.
//
// Claude Code writes a JSONL transcript per session under
// ~/.claude/projects/**/*.jsonl. Each assistant message carries a `usage`
// object with REAL token counts: input, output, and the cache split
// (cache_read vs cache_creation). This is ground truth for the heaviest
// workload on the machine, with no estimation.
//
// Privacy: this adapter reads ONLY the usage numbers, the model id, and the
// timestamp from each message. It never reads message content. (See
// PRIVACY.md.)
//
// Completeness: a transparency tool must not under-report because it happened
// to be closed. So we do NOT seek to end-of-file on start. We keep a persisted
// read cursor per transcript (bytes already accounted) and, on first ever run,
// scan the full history. Every message is counted exactly once — the cursor
// stops us re-reading a file, and a persisted set of seen message ids stops a
// resumed session (which copies earlier turns into a new file) being
// double-counted. Messages dated today are emitted live ('usage'); earlier
// days are emitted as a batched 'history' rollup for the caller to persist.
//
// This mirrors how Claude's own built-in stats scan transcripts, but keeps the
// full token throughput (cache reads included) and dates each message to the
// day it actually happened, rather than to its session's first timestamp.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const POLL_MS = 4000;
const PERSIST_MS = 10000;

class ClaudeCodeMonitor extends EventEmitter {
  // opts.stateFile: () => absolute path to the scan-state file (cursors + seen).
  // opts.shouldColdBackfill: () => boolean — when there is no scan state yet,
  //   whether to scan history from zero. Callers pass false when a prior build
  //   already rolled up real usage, so we never double-count on upgrade.
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.root = opts.root || ROOT; // transcripts dir (overridable for tests)
    this.positions = new Map(); // file -> bytes already accounted
    this.seen = new Set(); // message ids already counted (across files/restarts)
    this.timer = null;
    this.persistTimer = null;
    this.dirty = false;
  }

  stateFile() {
    const s = this.opts.stateFile;
    return typeof s === 'function' ? s() : s;
  }

  start() {
    if (!fs.existsSync(this.root)) return; // Claude Code not installed
    const hadState = this.loadState();
    if (!hadState) {
      // No cursor state. Either a fresh install (scan everything) or an upgrade
      // from a build that already recorded usage (start from the end so we do
      // not re-count what history already holds).
      const cold = this.opts.shouldColdBackfill ? this.opts.shouldColdBackfill() : true;
      if (!cold) {
        for (const f of this.listTranscripts()) {
          try {
            this.positions.set(f, fs.statSync(f).size);
          } catch {}
        }
        this.persist(true);
      }
      // cold === true: leave positions unset so each file reads from 0.
    }
    this.poll(); // immediate catch-up: reads each cursor -> EOF
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.persist(true);
  }

  loadState() {
    let raw;
    try {
      raw = fs.readFileSync(this.stateFile(), 'utf8');
    } catch {
      return false;
    }
    try {
      const s = JSON.parse(raw);
      for (const [f, b] of Object.entries(s.cursors || {})) this.positions.set(f, b);
      for (const id of s.seen || []) this.seen.add(id);
      return true;
    } catch {
      return false;
    }
  }

  persist(immediate = false) {
    const write = () => {
      this.dirty = false;
      const file = this.stateFile();
      if (!file) return;
      try {
        fs.writeFileSync(
          file,
          JSON.stringify({ cursors: Object.fromEntries(this.positions), seen: [...this.seen] })
        );
      } catch {}
    };
    if (immediate) {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = null;
      return write();
    }
    this.dirty = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (this.dirty) write();
    }, PERSIST_MS);
  }

  listTranscripts() {
    const out = [];
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.jsonl')) out.push(p);
      }
    };
    walk(this.root);
    return out;
  }

  poll() {
    const today = new Date().toDateString();
    const history = Object.create(null); // date -> { requests, models: {model: {in,cw,cr,out,requests}} }
    let advanced = false;
    for (const f of this.listTranscripts()) {
      let size;
      try {
        size = fs.statSync(f).size;
      } catch {
        continue;
      }
      const from = this.positions.get(f) ?? 0;
      if (size <= from) {
        if (size !== from) {
          this.positions.set(f, size); // truncated/rotated
          advanced = true;
        }
        continue;
      }
      this.readFrom(f, from, size, today, history);
      this.positions.set(f, size);
      advanced = true;
    }
    const dates = Object.keys(history);
    if (dates.length) this.emit('history', { days: history });
    if (advanced) this.persist();
  }

  readFrom(file, from, to, today, history) {
    let buf;
    try {
      const fd = fs.openSync(file, 'r');
      buf = Buffer.alloc(to - from);
      fs.readSync(fd, buf, 0, to - from, from);
      fs.closeSync(fd);
    } catch {
      return;
    }
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue; // partial line at boundary; picked up next poll if completed
      }
      if (o.type !== 'assistant') continue;
      const m = o.message || {};
      const u = m.usage;
      const id = m.id;
      if (!u || !id || this.seen.has(id)) continue;
      // Skip synthetic messages (local interrupts, not real inference).
      if (typeof m.model === 'string' && m.model.startsWith('<')) continue;
      const inputTokens = u.input_tokens || 0;
      const cacheReadTokens = u.cache_read_input_tokens || 0;
      const cacheCreationTokens = u.cache_creation_input_tokens || 0;
      const outputTokens = u.output_tokens || 0;
      if (inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens === 0) continue;
      this.seen.add(id);
      const model = m.model || 'unknown';
      const ts = o.timestamp || null;
      const day = ts ? new Date(ts).toDateString() : today;
      if (day === today) {
        // Live path: folds into today's running totals (includes anything
        // written earlier today while Drippy was closed).
        this.emit('usage', { model, ts, inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens });
      } else {
        // Historical path: batched rollup for the caller to persist per day.
        const d = history[day] || (history[day] = { requests: 0, models: Object.create(null) });
        d.requests += 1;
        const mm = d.models[model] || (d.models[model] = { in: 0, cw: 0, cr: 0, out: 0, requests: 0 });
        mm.in += inputTokens;
        mm.cw += cacheCreationTokens;
        mm.cr += cacheReadTokens;
        mm.out += outputTokens;
        mm.requests += 1;
      }
    }
  }
}

module.exports = ClaudeCodeMonitor;
