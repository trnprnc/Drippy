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

module.exports = { init, appendRequest, appendPrivacy, appendSuggestion, finalizeDay, readDays };
