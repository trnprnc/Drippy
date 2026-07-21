// Sync — the Phase 1 upload contract (DATA-STORAGE.md).
//
// Off by default; nothing here runs until the user opts in. When enabled,
// local history is batched into the upload shapes below, every batch is
// written to an append-only upload ledger BEFORE it is sent and its
// outcome appended after, and the payload is exactly what the ledger
// describes. If Drippy cannot say what it sent, it does not send.
//
// The shapes are rebuilt through whitelists here (and again at the
// ingest), so no field that could hold content can travel, structurally.
//
// Files (all in userData):
//   sync.json        { enabled, endpoint, workspaceId, deviceId, deviceKey }
//   sync-cursor.json { lastEventTs, lastDayDate, lastTodayHash }
//   ledger.jsonl     one line per batch intent + one per outcome

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POLICY = '1'; // upload contract version, stated in envelope and ledger
const BATCH_LIMIT = 500;
const TICK_MS = 60 * 60 * 1000; // hourly for the current day
const FIRST_TICK_MS = 45 * 1000; // settle after launch first

let dir = null;
let historyDir = null;
let getToday = null;
let getMeta = null;
let cfg = { enabled: false, endpoint: null, workspaceId: null, deviceId: null, deviceKey: null };
let cursor = { lastEventTs: '', lastDayDate: '', lastTodayHash: '' };
let timer = null;
let ticking = false;

const cfgFile = () => path.join(dir, 'sync.json');
const cursorFile = () => path.join(dir, 'sync-cursor.json');
const ledgerFile = () => path.join(dir, 'ledger.jsonl');

const readJson = (f, fallback) => {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch {
    return { ...fallback };
  }
};
const writeJson = (f, obj) => {
  try {
    fs.writeFileSync(f, JSON.stringify(obj));
  } catch {}
};

// ---------------------------------------------------------------------------
// Upload shapes — pure functions, exported for tests.
// ---------------------------------------------------------------------------

function isoDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Old privacy records carried category ids as strings; new ones carry
// { id, tier } objects. Normalise to the object form.
function normCats(cats) {
  if (!Array.isArray(cats)) return [];
  return cats.map((c) => (typeof c === 'string' ? { id: c, tier: null } : { id: c.id, tier: c.tier ?? null }));
}

function toRollupRecord(day, tzOffsetMin) {
  const date = isoDate(day.date);
  if (!date) return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    kind: 'rollup',
    date,
    tzOffsetMin,
    requests: n(day.requests),
    fgRequests: n(day.fgRequests),
    aiSeconds: n(day.aiSeconds),
    wh: n(day.wh),
    waterMl: n(day.waterMl),
    gco2: n(day.gco2),
    usd: n(day.usd),
    tokensIn: n(day.tokensIn),
    tokensOut: n(day.tokensOut),
    privacyEvents: n(day.privacyEvents),
    privacyByCat: day.privacyByCat && typeof day.privacyByCat === 'object' ? day.privacyByCat : {},
    apps: day.apps && typeof day.apps === 'object' ? day.apps : {},
    models: day.models && typeof day.models === 'object' ? day.models : {},
    bytesEstIn: n(day.bytesEstIn),
    bytesEstOut: n(day.bytesEstOut),
  };
}

function toEventRecord(e) {
  if (!e || typeof e.ts !== 'string') return null;
  if (e.t === 'req') {
    const r = {
      kind: 'request',
      ts: e.ts,
      app: String(e.app || ''),
      fg: !!e.fg,
      ms: e.ms || 0,
      basis: e.basis === 'measured' ? 'measured' : 'estimated',
      in: e.in || 0,
      out: e.out || 0,
      wh: e.wh || 0,
      fv: e.fv || null,
    };
    if (e.model) r.model = String(e.model);
    if (e.tier != null) r.tier = e.tier;
    if (e.tk) r.tk = { in: e.tk.in || 0, cw: e.tk.cw || 0, cr: e.tk.cr || 0, out: e.tk.out || 0 };
    if (e.bytes) r.bytes = { in: e.bytes.in || 0, out: e.bytes.out || 0 };
    return r;
  }
  if (e.t === 'priv') {
    return {
      kind: 'privacy',
      ts: e.ts,
      source: e.source || null,
      cats: normCats(e.cats),
      topTier: e.topTier ?? null,
      resolution: e.resolution || null,
      msToClear: e.msToClear ?? null,
    };
  }
  if (e.t === 'sug') {
    return { kind: 'notice', ts: e.ts, id: String(e.id || ''), family: e.family || null };
  }
  return null;
}

// Stable content hash: shapes are built with fixed key order, so plain
// JSON is deterministic. The ingest dedupes on it.
function recordHash(record) {
  return crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

// ---------------------------------------------------------------------------
// Local reads
// ---------------------------------------------------------------------------

function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function monthName(d) {
  return `events-${d.toISOString().slice(0, 7)}.jsonl`;
}

function readNewEvents() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const lines = [...readJsonl(path.join(historyDir, monthName(prev))), ...readJsonl(path.join(historyDir, monthName(now)))];
  return lines
    .filter((e) => e.ts > cursor.lastEventTs)
    .map(toEventRecord)
    .filter(Boolean)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1))
    .slice(0, BATCH_LIMIT);
}

function readNewDays(tzOffsetMin) {
  return readJsonl(path.join(historyDir, 'days.jsonl'))
    .map((d) => toRollupRecord(d, tzOffsetMin))
    .filter((r) => r && r.date > cursor.lastDayDate);
}

// ---------------------------------------------------------------------------
// Ledger — append-only; intent first, outcome after.
// ---------------------------------------------------------------------------

function appendLedger(entry) {
  try {
    fs.appendFileSync(ledgerFile(), JSON.stringify(entry) + '\n');
  } catch {}
}

// Latest state per batch, newest first, for the "What has been shared" view.
function ledgerTail(n = 12) {
  const byBatch = new Map();
  for (const e of readJsonl(ledgerFile())) {
    const cur = byBatch.get(e.batchId);
    byBatch.set(e.batchId, { ...cur, ...e });
  }
  return [...byBatch.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, n);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function postJson(url, body, key) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// The sync cycle
// ---------------------------------------------------------------------------

function countBy(records) {
  const c = {};
  for (const r of records) c[r.kind] = (c[r.kind] || 0) + 1;
  return c;
}

async function tick(trigger = 'timer') {
  if (!cfg.enabled || !cfg.endpoint || !cfg.deviceKey || ticking) return;
  ticking = true;
  try {
    const meta = getMeta();
    const days = readNewDays(meta.tzOffsetMin);
    const events = readNewEvents();
    const records = [...days, ...events];

    // The current day rides along as an upsert, but only when it changed.
    const today = toRollupRecord(getToday(), meta.tzOffsetMin);
    const todayHash = today ? recordHash(today) : '';
    if (today && today.requests + today.privacyEvents > 0 && todayHash !== cursor.lastTodayHash) {
      records.push(today);
    }
    if (!records.length) return;

    const envelope = {
      v: 1,
      policy: POLICY,
      batchId: crypto.randomUUID(),
      workspaceId: cfg.workspaceId,
      deviceId: cfg.deviceId,
      sentAt: new Date().toISOString(),
      appVersion: meta.appVersion,
      os: meta.os,
      osVersion: meta.osVersion,
      factorsVersion: meta.factorsVersion,
      tzOffsetMin: meta.tzOffsetMin,
      country: meta.country,
    };
    const body = JSON.stringify({ envelope, records: records.map((r) => ({ ...r, hash: recordHash(r) })) });

    // Intent line first: the ledger describes the payload before it moves.
    const base = {
      at: envelope.sentAt,
      batchId: envelope.batchId,
      endpoint: cfg.endpoint,
      policy: POLICY,
      trigger,
      counts: countBy(records),
      records: records.length,
      bytes: Buffer.byteLength(body),
      sha256: crypto.createHash('sha256').update(body).digest('hex'),
    };
    appendLedger({ ...base, status: 'sending' });

    try {
      const out = await postJson(`${cfg.endpoint}/v1/batch`, body, cfg.deviceKey);
      appendLedger({ batchId: envelope.batchId, at: new Date().toISOString(), status: 'ok', accepted: out.accepted, duplicates: out.duplicates });
      if (days.length) cursor.lastDayDate = days[days.length - 1].date;
      if (events.length) cursor.lastEventTs = events[events.length - 1].ts;
      cursor.lastTodayHash = todayHash;
      writeJson(cursorFile(), cursor);
      console.log(`[drippy] sync — ${records.length} records (${JSON.stringify(base.counts)}) → ${cfg.endpoint} (${trigger})`);
    } catch (err) {
      appendLedger({ batchId: envelope.batchId, at: new Date().toISOString(), status: 'failed', error: String(err.message || err).slice(0, 200) });
      console.log(`[drippy] sync failed — ${err.message || err}`);
    }
  } finally {
    ticking = false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle & control
// ---------------------------------------------------------------------------

function init(opts) {
  dir = opts.dir;
  historyDir = path.join(dir, 'history');
  getToday = opts.getToday;
  getMeta = opts.getMeta;
  cfg = readJson(cfgFile(), cfg);
  cursor = readJson(cursorFile(), cursor);
  if (!cfg.endpoint) cfg.endpoint = opts.defaultEndpoint || null;
  if (cfg.enabled) startTimer();
}

function startTimer() {
  clearInterval(timer);
  timer = setInterval(() => tick('timer'), TICK_MS);
  timer.unref?.();
  setTimeout(() => tick('startup'), FIRST_TICK_MS).unref?.();
}

async function setEnabled(enabled) {
  if (!enabled) {
    cfg.enabled = false;
    clearInterval(timer);
    timer = null;
    writeJson(cfgFile(), cfg);
    console.log('[drippy] sync off');
    return info();
  }
  if (!cfg.endpoint) throw new Error('no sync endpoint configured');
  if (!cfg.deviceId) {
    // Personal-workspace enrolment (Phase 1; sign-in method is still an
    // open decision, so enrolment is anonymous-device for now).
    const out = await postJson(`${cfg.endpoint}/v1/enroll`, JSON.stringify({ workspaceKind: 'personal' }), null);
    cfg.workspaceId = out.workspaceId;
    cfg.deviceId = out.deviceId;
    cfg.deviceKey = out.deviceKey;
  }
  cfg.enabled = true;
  writeJson(cfgFile(), cfg);
  console.log(`[drippy] sync on — workspace ${cfg.workspaceId}, device ${cfg.deviceId}`);
  startTimer();
  tick('opt-in');
  return info();
}

function info() {
  return {
    enabled: cfg.enabled,
    endpoint: cfg.endpoint,
    workspaceId: cfg.workspaceId,
    deviceId: cfg.deviceId,
    ledger: ledgerTail(),
  };
}

function poke(trigger = 'day-close') {
  tick(trigger);
}

module.exports = { init, setEnabled, info, poke, POLICY, toRollupRecord, toEventRecord, normCats, recordHash, isoDate, ledgerTail };
