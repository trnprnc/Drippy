// Local usage history — append-only JSONL on this device.
//   history/days.jsonl          one line per completed day (the trend source)
//   history/events-YYYY-MM.jsonl per-request and per-privacy-event records
// Records contain app names, drivers (token classes, bytes, model, factor
// version) and PII *categories* only — never content (see PRIVACY.md and
// DATA-STORAGE.md for the shapes and what may leave the device).

const fs = require('fs');
const path = require('path');

let dir = null;

function init(baseDir) {
  dir = path.join(baseDir, 'history');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function append(file, obj) {
  if (!dir) return;
  try {
    fs.appendFileSync(path.join(dir, file), JSON.stringify(obj) + '\n');
  } catch {}
}

function monthFile(ts) {
  return `events-${ts.slice(0, 7)}.jsonl`;
}

function appendRequest(r) {
  append(monthFile(r.ts), { t: 'req', ...r });
}

function appendPrivacy(p) {
  append(monthFile(p.ts), { t: 'priv', ...p });
}

function appendSuggestion(sg) {
  append(monthFile(sg.ts), { t: 'sug', ...sg });
}

function readDays(n = 30) {
  if (!dir) return [];
  try {
    const lines = fs.readFileSync(path.join(dir, 'days.jsonl'), 'utf8').trim().split('\n');
    return lines
      .slice(-n)
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

function finalizeDay(record) {
  const days = readDays(2);
  if (days.some((d) => d.date === record.date)) return; // already rolled up
  append('days.jsonl', record);
}

// Every recorded day, oldest first — the whole file, not just a tail. Used by
// the completeness backfill (claude-code.js) so historical days can be merged
// in without losing what is already there.
function readAllDays() {
  if (!dir) return [];
  try {
    return fs
      .readFileSync(path.join(dir, 'days.jsonl'), 'utf8')
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

// Deep additive merge of two day records. Only ever fed message sets that are
// disjoint (dedup happens upstream by message id + read cursor), so adding is
// correct: a day's totals are the sum of every request seen for that day.
function addInto(target, add) {
  for (const [k, v] of Object.entries(add)) {
    if (k === 'date') continue;
    if (typeof v === 'number') target[k] = (target[k] || 0) + v;
    else if (v && typeof v === 'object') addInto((target[k] = target[k] || {}), v);
    else target[k] = v; // strings (e.g. factor version) — last writer wins
  }
  return target;
}

// Upsert a day record, merging additively when the day already exists. Rewrites
// days.jsonl in date order. Cheap: the file is one short line per day.
function upsertDay(record) {
  if (!dir) return;
  const byDate = new Map(readAllDays().map((d) => [d.date, d]));
  const existing = byDate.get(record.date);
  byDate.set(record.date, existing ? addInto(existing, record) : record);
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  try {
    fs.writeFileSync(path.join(dir, 'days.jsonl'), out.map((d) => JSON.stringify(d)).join('\n') + '\n');
  } catch {}
}

// Has any measured (exact, non-estimated) usage ever been rolled up? Guards the
// one-time cold backfill: if a prior build already recorded real usage, we do
// NOT re-scan history from zero (that would double-count) — we just carry on.
function hasMeasuredHistory() {
  return readAllDays().some((d) => d.models && Object.keys(d.models).some((m) => m && m !== 'estimated'));
}

module.exports = {
  init,
  appendRequest,
  appendPrivacy,
  appendSuggestion,
  finalizeDay,
  readDays,
  readAllDays,
  upsertDay,
  hasMeasuredHistory,
};
