// WorkSession contract: one steady "working" state across the gaps between an
// agent's API calls, and exactly one "settled" when the work really stops.
// Run: node test/presence.test.js

const assert = require('assert');
const WorkSession = require('../presence');

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

// --- virtual clock ------------------------------------------------------------
function makeClock() {
  let now = 0;
  let seq = 1;
  let timers = [];
  const api = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const t = { id: seq++, at: now + ms, fn };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    advance: (ms) => {
      const target = now + ms;
      timers.sort((a, b) => a.at - b.at);
      while (timers.length && timers[0].at <= target) {
        const t = timers.shift();
        now = t.at;
        t.fn();
        timers.sort((a, b) => a.at - b.at);
      }
      now = target;
    },
  };
  return api;
}

function makeSession(settleMs = 30000) {
  const clk = makeClock();
  const ws = new WorkSession({ settleMs, now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout });
  const events = [];
  ws.on('start', (e) => events.push(['start', e]));
  ws.on('settled', (e) => events.push(['settled', e]));
  return { ws, clk, events };
}

check('activity starts a working session', () => {
  const { ws, events } = makeSession();
  assert.strictEqual(ws.isWorking(), false);
  ws.activity({ request: true });
  assert.strictEqual(ws.isWorking(), true);
  assert.deepStrictEqual(events.map((e) => e[0]), ['start']);
});

check('stays working across gaps shorter than the settle window (no flicker)', () => {
  const { ws, clk, events } = makeSession(30000);
  ws.activity({ request: true }); // t=0
  for (const _ of [1, 2, 3, 4]) {
    clk.advance(20000); // 20s gaps < 30s settle
    assert.strictEqual(ws.isWorking(), true, 'should still be working mid-gap');
    ws.activity({ request: true });
  }
  // one start, never settled while activity keeps coming
  assert.deepStrictEqual(events.map((e) => e[0]), ['start']);
  assert.strictEqual(ws.isWorking(), true);
});

check('settles exactly once after the quiet window, with duration and request count', () => {
  const { ws, clk, events } = makeSession(30000);
  ws.activity({ request: true }); // t=0, req 1
  clk.advance(5000);
  ws.activity({ request: true }); // t=5s, req 2
  clk.advance(10000);
  ws.activity(); // t=15s, non-request keeps it alive, no extra request
  clk.advance(30000); // quiet -> settle at t=45s (last activity was t=15s)
  const settled = events.filter((e) => e[0] === 'settled');
  assert.strictEqual(settled.length, 1, 'settled must fire once');
  assert.strictEqual(settled[0][1].requests, 2);
  assert.strictEqual(settled[0][1].durationMs, 15000, 'duration = last activity - start');
  assert.strictEqual(ws.isWorking(), false);
  // no further settles as time rolls on
  clk.advance(60000);
  assert.strictEqual(events.filter((e) => e[0] === 'settled').length, 1);
});

check('a new burst after settling starts a fresh session', () => {
  const { ws, clk, events } = makeSession(30000);
  ws.activity({ request: true });
  clk.advance(30000); // settle
  ws.activity({ request: true }); // new session
  assert.deepStrictEqual(events.map((e) => e[0]), ['start', 'settled', 'start']);
  assert.strictEqual(ws.isWorking(), true);
});

check('a one-shot reply is a short session the caller can choose to ignore', () => {
  const { ws, clk, events } = makeSession(30000);
  ws.activity({ request: true }); // t=0, single call
  clk.advance(30000);
  const s = events.find((e) => e[0] === 'settled')[1];
  assert.strictEqual(s.requests, 1);
  assert.strictEqual(s.durationMs, 0); // start == last activity
});

console.log(failures ? `\n${failures} check(s) failed` : '\nall presence cases pass');
process.exit(failures ? 1 : 0);
