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
// Forward-only: on start we seek to the end of existing transcripts and
// count only messages written from now on, so we never double-count against
// persisted daily state or the network monitor.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const POLL_MS = 4000;

class ClaudeCodeMonitor extends EventEmitter {
  constructor() {
    super();
    this.positions = new Map(); // file -> bytes already read
    this.seen = new Set(); // message ids already counted
    this.timer = null;
  }

  start() {
    if (!fs.existsSync(ROOT)) return; // Claude Code not installed
    // Seek to end of every existing transcript: forward-only.
    for (const f of this.listTranscripts()) {
      try {
        this.positions.set(f, fs.statSync(f).size);
      } catch {}
    }
    this.timer = setInterval(() => this.poll(), POLL_MS);
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
    walk(ROOT);
    return out;
  }

  poll() {
    for (const f of this.listTranscripts()) {
      let size;
      try {
        size = fs.statSync(f).size;
      } catch {
        continue;
      }
      const from = this.positions.get(f) ?? 0;
      if (size <= from) {
        this.positions.set(f, size); // unchanged or truncated
        continue;
      }
      this.readFrom(f, from, size);
      this.positions.set(f, size);
    }
  }

  readFrom(file, from, to) {
    let buf;
    try {
      const fd = fs.openSync(file, 'r');
      buf = Buffer.alloc(to - from);
      fs.readSync(fd, buf, 0, to - from, from);
      fs.closeSync(fd);
    } catch {
      return;
    }
    const today = new Date().toDateString();
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
      const anyTokens =
        (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      if (anyTokens === 0) continue;
      this.seen.add(id);
      if (o.timestamp && new Date(o.timestamp).toDateString() !== today) continue;
      this.emit('usage', {
        model: m.model || 'unknown',
        inputTokens: u.input_tokens || 0,
        cacheReadTokens: u.cache_read_input_tokens || 0,
        cacheCreationTokens: u.cache_creation_input_tokens || 0,
        outputTokens: u.output_tokens || 0,
      });
    }
  }
}

module.exports = ClaudeCodeMonitor;
