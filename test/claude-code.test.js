// Completeness contract for the Claude Code adapter: the full transcript
// history is counted exactly once, deduped, and bucketed to the day each
// message actually happened — regardless of how much of the time Drippy ran.
// Run: node test/claude-code.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ClaudeCodeMonitor = require('../claude-code');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  -', name);
  } catch (e) {
    failures++;
    console.log('  FAIL-', name, '\n     ', e.message);
  }
}

// --- build a throwaway ~/.claude/projects tree --------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drippy-cc-'));
const root = path.join(tmp, 'projects');
const projA = path.join(root, 'proj-a');
const projB = path.join(root, 'proj-b');
fs.mkdirSync(projA, { recursive: true });
fs.mkdirSync(projB, { recursive: true });
const stateFile = path.join(tmp, 'cc-scan.json');

const today = new Date();
const iso = (d, h = 12) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString();
const dayStr = (d) => new Date(d).toDateString();
const past1 = new Date(today.getTime() - 3 * 864e5);
const past2 = new Date(today.getTime() - 1 * 864e5);

const asst = (id, ts, model, u) =>
  JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model, usage: u } });
const U = (i, cr, cc, o) => ({
  input_tokens: i,
  cache_read_input_tokens: cr,
  cache_creation_input_tokens: cc,
  output_tokens: o,
});

// Session 1 (proj-a): two past-day messages + a synthetic + a zero-token one.
fs.writeFileSync(
  path.join(projA, 's1.jsonl'),
  [
    asst('m1', iso(past1), 'claude-opus-4-8', U(10, 1000, 100, 50)),
    asst('m2', iso(past1, 13), 'claude-fable-5', U(5, 500, 0, 20)),
    asst('m-syn', iso(past1), '<synthetic>', U(0, 0, 0, 0)),
    asst('m-zero', iso(past1), 'claude-opus-4-8', U(0, 0, 0, 0)),
    JSON.stringify({ type: 'user', timestamp: iso(past1) }), // ignored for tokens
    asst('m3', iso(past2), 'claude-opus-4-8', U(8, 800, 0, 40)),
  ].join('\n') + '\n'
);

// Session 2 (proj-b): a RESUME that copies m3 (same id — must not double count)
// plus a genuinely new message on the same past day, and one dated today.
fs.writeFileSync(
  path.join(projB, 's2.jsonl'),
  [
    asst('m3', iso(past2), 'claude-opus-4-8', U(8, 800, 0, 40)), // duplicate id
    asst('m4', iso(past2, 9), 'claude-fable-5', U(4, 400, 0, 10)),
    asst('m5-today', iso(today), 'claude-opus-4-8', U(3, 300, 0, 15)),
  ].join('\n') + '\n'
);

function freshMonitor() {
  return new ClaudeCodeMonitor({ root, stateFile: () => stateFile, shouldColdBackfill: () => true });
}

// --- pass 1: cold backfill ----------------------------------------------------
const hist1 = {};
let usage1 = 0;
const m1 = freshMonitor();
m1.on('history', ({ days }) => {
  for (const [date, agg] of Object.entries(days)) {
    const h = (hist1[date] = hist1[date] || { requests: 0, tok: { in: 0, cw: 0, cr: 0, out: 0 } });
    h.requests += agg.requests;
    for (const t of Object.values(agg.models)) {
      h.tok.in += t.in;
      h.tok.cw += t.cw;
      h.tok.cr += t.cr;
      h.tok.out += t.out;
    }
  }
});
m1.on('usage', () => usage1++);
m1.start();
m1.stop();

check('past days are the two distinct calendar days', () => {
  assert.deepStrictEqual(Object.keys(hist1).sort(), [dayStr(past1), dayStr(past2)].sort());
});
check('today is emitted live, never in the history batch', () => {
  assert.strictEqual(usage1, 1, `expected 1 today usage event, got ${usage1}`);
  assert.ok(!hist1[dayStr(today)], 'today must not appear in history rollup');
});
check('synthetic and zero-token messages are skipped', () => {
  // past1 has m1 + m2 only (syn + zero dropped) => 2 requests
  assert.strictEqual(hist1[dayStr(past1)].requests, 2);
});
check('duplicate message id across files is counted once', () => {
  // past2: m3 (once, despite appearing in s1 and s2) + m4 => 2 requests
  assert.strictEqual(hist1[dayStr(past2)].requests, 2);
});
check('token classes bucket to the right day', () => {
  assert.deepStrictEqual(hist1[dayStr(past1)].tok, { in: 15, cw: 100, cr: 1500, out: 70 });
  assert.deepStrictEqual(hist1[dayStr(past2)].tok, { in: 12, cw: 0, cr: 1200, out: 50 });
});

// --- pass 2: cursors persisted -> nothing re-counted --------------------------
let hist2 = 0;
let usage2 = 0;
const m2 = freshMonitor();
m2.on('history', ({ days }) => (hist2 += Object.keys(days).length));
m2.on('usage', () => usage2++);
m2.start();
m2.stop();
check('re-run with persisted cursors emits nothing', () => {
  assert.strictEqual(hist2, 0, `history re-emitted ${hist2} days`);
  assert.strictEqual(usage2, 0, `usage re-emitted ${usage2} events`);
});

// --- append a new message -> only the delta is read ---------------------------
fs.appendFileSync(
  path.join(projB, 's2.jsonl'),
  asst('m6', iso(past2, 15), 'claude-opus-4-8', U(1, 100, 0, 5)) + '\n'
);
let deltaDays = 0;
let deltaReq = 0;
const m3 = freshMonitor();
m3.on('history', ({ days }) => {
  deltaDays += Object.keys(days).length;
  for (const agg of Object.values(days)) deltaReq += agg.requests;
});
m3.start();
m3.stop();
check('appended message is read incrementally, just the delta', () => {
  assert.strictEqual(deltaDays, 1);
  assert.strictEqual(deltaReq, 1);
});

// --- upgrade guard: cursor lost but shouldColdBackfill=false ⇒ no re-scan ------
fs.rmSync(stateFile, { force: true });
let guardDays = 0;
const m4 = new ClaudeCodeMonitor({ root, stateFile: () => stateFile, shouldColdBackfill: () => false });
m4.on('history', ({ days }) => (guardDays += Object.keys(days).length));
m4.start();
m4.stop();
check('no cursor + shouldColdBackfill=false does not re-backfill', () => {
  assert.strictEqual(guardDays, 0);
  assert.ok(fs.existsSync(stateFile), 'a fresh cursor file should be written');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall claude-code completeness cases pass');
process.exit(failures ? 1 : 0);
