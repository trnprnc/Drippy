// L1 activity monitor — flow metadata only, no content, no decryption.
//
// Prototype implementation: polls lsof (cheap, every 5s) to find processes
// with established connections to Anthropic, then samples nettop (every
// 1.5s, only while such connections exist) for per-connection byte counts.
// Sustained inbound bytes = a response streaming = "request in flight".
//
// The shipping version replaces this with a push-based NEFilterDataProvider
// system extension (zero polling); it must emit the same events, so the rest
// of the app never knows the difference.

const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const dns = require('dns').promises;

const HOSTS = ['claude.ai', 'api.anthropic.com'];
// Anthropic's own address space (ARIN 160.79.104.0/23) — claude.ai and
// api.anthropic.com both resolve here. Prefix match survives DNS rotation.
const V4_PREFIXES = ['160.79.104.', '160.79.105.'];
const V6_PREFIXES = ['2607:6bc0:'];

// Adaptive cadence: when the user is present in a Claude surface the
// monitor runs hot so the blob reacts in ~1s; an idle machine gets the
// light, slow cadence. main.js flips this via setHot().
const CADENCE = {
  hot: { slow: 2000, fast: 800 },
  cold: { slow: 6000, fast: 1500 },
};
const IP_REFRESH_MS = 10 * 60 * 1000;
// Streaming heuristics, bytes per fast sample. A streaming response arrives
// at roughly 5–15 kB/s on the wire; TLS keepalives are far below these.
// A single large burst starts a request immediately; smaller activity must
// persist for two consecutive samples (filters telemetry/config-fetch blips).
const BIG_IN = 12000;
const BIG_OUT = 6000;
const START_IN = 2500;
const START_OUT = 1500; // a prompt being uploaded counts as "started"
const END_IN = 800;
// Streams pause while the model thinks — require a longer quiet stretch
// before declaring a request finished, or one exchange splits into several.
const END_QUIET_MS = 6000;

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

class AnthropicMonitor extends EventEmitter {
  constructor() {
    super();
    this.resolvedIps = new Set();
    this.candidates = new Map(); // pid -> app name (has Anthropic connections)
    this.prevBytes = new Map(); // "pid|socket" -> { in, out }
    this.flows = new Map(); // pid -> flow state
    this.fastTimer = null;
    this.slowTimer = null;
    this.heat = 'cold';
  }

  start() {
    this.refreshIps();
    setInterval(() => this.refreshIps(), IP_REFRESH_MS).unref();
    this.slowTimer = setInterval(() => this.slowScan(), CADENCE[this.heat].slow);
    this.slowScan();
  }

  setHot(hot) {
    const heat = hot ? 'hot' : 'cold';
    if (heat === this.heat) return;
    this.heat = heat;
    clearInterval(this.slowTimer);
    this.slowTimer = setInterval(() => this.slowScan(), CADENCE[heat].slow);
    if (this.fastTimer) {
      clearInterval(this.fastTimer);
      this.fastTimer = setInterval(() => this.fastSample(), CADENCE[heat].fast);
    }
  }

  // Immediate scan — called when the user starts typing (a send is likely).
  poke() {
    this.slowScan();
  }

  async refreshIps() {
    const next = new Set();
    for (const host of HOSTS) {
      for (const resolve of [dns.resolve4(host), dns.resolve6(host)]) {
        try {
          for (const ip of await resolve) next.add(ip.toLowerCase());
        } catch {}
      }
    }
    if (next.size) this.resolvedIps = next;
  }

  isAnthropic(ip) {
    const norm = ip.toLowerCase();
    return (
      this.resolvedIps.has(norm) ||
      V4_PREFIXES.some((p) => norm.startsWith(p)) ||
      V6_PREFIXES.some((p) => norm.startsWith(p))
    );
  }

  // --- slow loop: who is connected to Anthropic at all? -------------------

  async slowScan() {
    const out = await run('lsof', ['-nP', '-iTCP', '-sTCP:ESTABLISHED', '-F', 'cpn']);
    const found = new Map();
    let pid = null;
    let cmd = null;
    for (const line of out.split('\n')) {
      const tag = line[0];
      const val = line.slice(1);
      if (tag === 'p') pid = Number(val);
      else if (tag === 'c') cmd = val;
      else if (tag === 'n' && pid && cmd) {
        const remote = val.split('->')[1];
        if (remote && this.isAnthropic(stripPort(remote))) found.set(pid, cmd);
      }
    }
    this.candidates = found;

    const shouldSample = found.size > 0;
    if (shouldSample && !this.fastTimer) {
      this.fastTimer = setInterval(() => this.fastSample(), CADENCE[this.heat].fast);
      this.fastSample(); // immediate baseline — first delta lands one tick sooner
      this.emit('watch', { watching: true, apps: [...new Set(found.values())] });
    } else if (!shouldSample && this.fastTimer) {
      clearInterval(this.fastTimer);
      this.fastTimer = null;
      this.prevBytes.clear();
      for (const p of this.flows.keys()) this.endFlow(p);
      this.emit('watch', { watching: false, apps: [] });
    } else if (shouldSample) {
      this.emit('watch', { watching: true, apps: [...new Set(found.values())] });
    }
  }

  // --- fast loop: are bytes actually moving? ------------------------------

  async fastSample() {
    const pids = [...this.candidates.keys()];
    if (!pids.length) return;
    const args = ['-x', '-L', '1', '-n', '-J', 'bytes_in,bytes_out', '-t', 'external'];
    for (const p of pids) args.push('-p', String(p));
    const out = await run('nettop', args);

    const deltas = new Map(); // pid -> { in, out }
    let pid = null;
    for (const line of out.split('\n')) {
      const cols = line.split(',');
      const head = cols[0];
      if (!head) continue;
      if (/^(tcp|udp)/.test(head.trim())) {
        if (pid === null) continue;
        const remote = head.split('<->')[1];
        if (!remote || !this.isAnthropic(stripPort(remote.trim()))) continue;
        const key = `${pid}|${head.trim()}`;
        const cur = { in: Number(cols[1]) || 0, out: Number(cols[2]) || 0 };
        const prev = this.prevBytes.get(key);
        this.prevBytes.set(key, cur);
        if (!prev) continue; // first sighting — no delta yet
        const d = deltas.get(pid) || { in: 0, out: 0 };
        d.in += Math.max(0, cur.in - prev.in);
        d.out += Math.max(0, cur.out - prev.out);
        deltas.set(pid, d);
      } else {
        const m = head.match(/\.(\d+)$/);
        pid = m ? Number(m[1]) : null;
      }
    }

    for (const [p, d] of deltas) this.updateFlow(p, d);
    // Flows whose pid produced no rows this sample count as quiet.
    for (const p of this.flows.keys()) {
      if (!deltas.has(p)) this.updateFlow(p, { in: 0, out: 0 });
    }
  }

  updateFlow(pid, d) {
    let f = this.flows.get(pid);
    const app = this.candidates.get(pid) || (f && f.app) || 'unknown';
    if (!f) {
      f = { app, active: false, bytesIn: 0, bytesOut: 0, startedAt: 0, lastDataAt: 0, pendingIn: 0, pendingOut: 0 };
      this.flows.set(pid, f);
    }
    if (!f.active) {
      const burst = d.in >= BIG_IN || d.out >= BIG_OUT;
      const warm = d.in >= START_IN || d.out >= START_OUT;
      if (burst || ((f.pendingIn > 0 || f.pendingOut > 0) && warm)) {
        f.active = true;
        f.bytesIn = f.pendingIn + d.in;
        f.bytesOut = f.pendingOut + d.out;
        f.pendingIn = 0;
        f.pendingOut = 0;
        f.startedAt = Date.now();
        f.lastDataAt = Date.now();
        this.emit('request-start', { app: f.app, pid });
      } else {
        f.pendingIn = warm ? d.in : 0;
        f.pendingOut = warm ? d.out : 0;
      }
    } else {
      f.bytesIn += d.in;
      f.bytesOut += d.out;
      if (d.in >= END_IN || d.out >= START_OUT) {
        f.lastDataAt = Date.now();
      } else if (Date.now() - f.lastDataAt > END_QUIET_MS) {
        this.endFlow(pid);
      }
    }
  }

  endFlow(pid) {
    const f = this.flows.get(pid);
    if (!f) return;
    this.flows.delete(pid);
    if (f.active) {
      this.emit('request-end', {
        app: f.app,
        pid,
        bytesIn: f.bytesIn,
        bytesOut: f.bytesOut,
        durationMs: Date.now() - f.startedAt,
      });
    }
  }
}

function stripPort(endpoint) {
  let e = endpoint.trim();
  // lsof brackets v6 addrs: "[2607:6bc0::10]:443" — take what's inside.
  if (e.startsWith('[')) {
    const close = e.indexOf(']');
    if (close !== -1) return normalizeIp(e.slice(1, close));
  }
  // tcp6 scoped addrs look like "fe80::1%en0.443"; tcp4 like "1.2.3.4:443".
  const scope = e.indexOf('%');
  if (scope !== -1) e = e.slice(0, scope);
  if (e.includes(':') && e.includes('.') && e.lastIndexOf('.') > e.lastIndexOf(':')) {
    return normalizeIp(e.slice(0, e.lastIndexOf('.'))); // v6 with .port suffix
  }
  const colon = e.lastIndexOf(':');
  if (colon !== -1 && colon === e.indexOf(':')) return normalizeIp(e.slice(0, colon)); // v4:port
  return normalizeIp(e);
}

function normalizeIp(ip) {
  // v4-mapped v6 ("::ffff:160.79.104.10") must match v4 prefixes.
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

module.exports = AnthropicMonitor;
