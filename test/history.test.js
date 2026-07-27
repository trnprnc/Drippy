// Storage contract for usage history: days are merged additively and always
// come back in real chronological order.
//
// Regression guard: dates are stored as toDateString() ("Fri Jul 17 2026"),
// which sorts by WEEKDAY NAME as a string. Sorting them textually silently
// scrambled the file, so "last 7 days" returned a mix of months.
// Run: node test/history.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const history = require('../history');

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drippy-hist-'));
history.init(tmp);

const day = (d) => new Date(2026, 5, d).toDateString(); // June 2026

// Written deliberately out of order, and spanning weekdays whose names sort
// differently from their dates.
const written = [22, 3, 17, 1, 30, 9].map((n) => day(n));
for (const d of written) history.upsertDay({ date: d, requests: 1, wh: 1, models: { 'claude-opus-4-8': { in: 1, cw: 0, cr: 0, out: 1, wh: 1, requests: 1 } } });

check('readAllDays returns real chronological order', () => {
  const got = history.readAllDays().map((d) => d.date);
  const want = [...written].sort((a, b) => new Date(a) - new Date(b));
  assert.deepStrictEqual(got, want);
});

check('readDays(n) takes the LATEST n, not an alphabetical tail', () => {
  const got = history.readDays(3).map((d) => d.date);
  assert.deepStrictEqual(got, [day(17), day(22), day(30)]);
});

check('upsertDay merges the same date additively', () => {
  history.upsertDay({ date: day(17), requests: 4, wh: 2.5, models: { 'claude-opus-4-8': { in: 9, cw: 0, cr: 100, out: 3, wh: 2.5, requests: 4 } } });
  const rec = history.readAllDays().find((d) => d.date === day(17));
  assert.strictEqual(rec.requests, 5, 'requests should sum');
  assert.strictEqual(rec.wh, 3.5, 'wh should sum');
  assert.strictEqual(rec.models['claude-opus-4-8'].cr, 100, 'nested token classes should sum');
  assert.strictEqual(rec.models['claude-opus-4-8'].requests, 5);
});

check('upserting does not duplicate the date', () => {
  const dates = history.readAllDays().map((d) => d.date);
  assert.strictEqual(new Set(dates).size, dates.length);
  assert.strictEqual(dates.length, written.length);
});

check('hasMeasuredHistory distinguishes measured from estimated', () => {
  assert.strictEqual(history.hasMeasuredHistory(), true);
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'drippy-hist2-'));
  history.init(t2);
  assert.strictEqual(history.hasMeasuredHistory(), false, 'empty history is not measured');
  history.upsertDay({ date: day(4), requests: 1, wh: 1, models: { estimated: { in: 10, cw: 0, cr: 0, out: 5, wh: 1, requests: 1 } } });
  assert.strictEqual(history.hasMeasuredHistory(), false, 'estimated-only must not count as measured');
  fs.rmSync(t2, { recursive: true, force: true });
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall history cases pass');
process.exit(failures ? 1 : 0);
