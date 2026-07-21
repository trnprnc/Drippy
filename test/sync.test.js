// Run: node test/sync.test.js
const { toRollupRecord, toEventRecord, normCats, recordHash, isoDate } = require('../sync');

let fails = 0;
const check = (name, ok) => {
  if (!ok) {
    fails++;
    console.log('FAIL:', name);
  }
};

// isoDate handles the local toDateString format used by day rollovers.
check('isoDate toDateString', /^\d{4}-07-\d{2}$/.test(isoDate('Tue Jul 21 2026')));
check('isoDate garbage', isoDate('not a date') === null);

// Rollups: whitelisted, defaulted, unknown fields dropped.
const rollup = toRollupRecord(
  { date: 'Tue Jul 21 2026', requests: 5, wh: 1.5, models: { 'claude-fable-5': { in: 2 } }, secretField: 'nope' },
  60
);
check('rollup kind', rollup.kind === 'rollup');
check('rollup tz', rollup.tzOffsetMin === 60);
check('rollup defaults', rollup.usd === 0 && rollup.tokensIn === 0);
check('rollup models kept', rollup.models['claude-fable-5'].in === 2);
check('rollup unknown dropped', !('secretField' in rollup));

// Request events: measured carries model + token classes, estimated bytes.
const measured = toEventRecord({
  t: 'req', ts: '2026-07-21T14:06:24.683Z', app: 'Claude Code', fg: true, ms: 0,
  basis: 'measured', model: 'claude-fable-5', tier: 1,
  tk: { in: 2, cw: 299, cr: 317437, out: 202 }, in: 317738, out: 202, wh: 1.804, fv: '2026.07.5',
  content: 'must never travel',
});
check('req kind', measured.kind === 'request');
check('req tk', measured.tk.cr === 317437);
check('req unknown dropped', !('content' in measured));
const estimated = toEventRecord({ t: 'req', ts: '2026-07-21T10:00:00Z', app: 'Claude', fg: false, bytes: { in: 20000, out: 3000 }, in: 400, out: 350, wh: 0.4 });
check('req estimated basis', estimated.basis === 'estimated');
check('req bytes', estimated.bytes.in === 20000);

// Privacy incidents: old string cats normalise, new object cats survive.
check('cats legacy', JSON.stringify(normCats(['email'])) === JSON.stringify([{ id: 'email', tier: null }]));
const priv = toEventRecord({
  t: 'priv', ts: '2026-07-21T12:00:00Z', source: 'clipboard',
  cats: [{ id: 'anthropic-key', tier: 1 }], topTier: 1, resolution: 'cleared-by-button', msToClear: 6100,
});
check('priv resolution', priv.resolution === 'cleared-by-button');
check('priv cats', priv.cats[0].tier === 1);

// Notices map; unknown kinds and malformed lines drop.
check('sug maps', toEventRecord({ t: 'sug', ts: '2026-07-21T09:00:00Z', id: 'batch-small', family: 'usage' }).kind === 'notice');
check('unknown kind dropped', toEventRecord({ t: 'wat', ts: '2026-07-21T09:00:00Z' }) === null);
check('missing ts dropped', toEventRecord({ t: 'req' }) === null);

// Hashes are stable for identical shapes, different for different ones.
check('hash stable', recordHash(measured) === recordHash(toEventRecord({
  t: 'req', ts: '2026-07-21T14:06:24.683Z', app: 'Claude Code', fg: true, ms: 0,
  basis: 'measured', model: 'claude-fable-5', tier: 1,
  tk: { in: 2, cw: 299, cr: 317437, out: 202 }, in: 317738, out: 202, wh: 1.804, fv: '2026.07.5',
})));
check('hash differs', recordHash(measured) !== recordHash(estimated));

console.log(fails === 0 ? 'all sync contract cases pass' : `${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
