// Run: node server/test.js  (uses the memory store; no database needed)
// Force the memory store even when a .env.local with DATABASE_URL exists,
// so tests never touch a real database. Set before requiring ingest: the
// store is chosen at module load, and env.js won't overwrite a key that
// is already present.
process.env.DATABASE_URL = '';
const { server } = require('./ingest');

let fails = 0;
const check = (name, ok) => {
  if (!ok) {
    fails++;
    console.log('FAIL:', name);
  }
};

const batch = (deviceId, workspaceId) => ({
  envelope: {
    v: 1, policy: '1', batchId: 'b-1', workspaceId, deviceId, sentAt: new Date().toISOString(),
    appVersion: '2.0.0', os: 'darwin', osVersion: '25.5.0', factorsVersion: '2026.07.5', tzOffsetMin: 60, country: 'GB',
  },
  records: [
    { kind: 'rollup', date: '2026-07-21', tzOffsetMin: 60, requests: 5, wh: 1.5, apps: { claude: { requests: 5, wh: 1.5 } } },
    {
      kind: 'request', ts: '2026-07-21T14:06:24.683Z', app: 'Claude Code', fg: true, ms: 0, basis: 'measured',
      model: 'claude-fable-5', tier: 1, tk: { in: 2, cw: 299, cr: 317437, out: 202 }, in: 317738, out: 202, wh: 1.804, fv: '2026.07.5',
      promptText: 'must be dropped at the door',
    },
    { kind: 'privacy', ts: '2026-07-21T12:00:00Z', source: 'clipboard', cats: [{ id: 'anthropic-key', tier: 1 }], topTier: 1, resolution: 'cleared-by-button', msToClear: 6100 },
    { kind: 'nonsense', ts: '2026-07-21T12:00:00Z' },
  ],
});

async function main() {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, key) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const health = await fetch(base + '/v1/health').then((r) => r.json());
  check('health', health.ok === true && health.db === 'memory');

  const enrol = await post('/v1/enroll', { workspaceKind: 'personal' });
  check('enroll', !!(enrol.workspaceId && enrol.deviceId && enrol.deviceKey));
  const orgRefused = await post('/v1/enroll', { workspaceKind: 'org' });
  check('org refused for now', !!orgRefused.error);

  const noAuth = await fetch(base + '/v1/batch', { method: 'POST', body: '{}' });
  check('batch needs auth', noAuth.status === 401);

  const first = await post('/v1/batch', batch(enrol.deviceId, enrol.workspaceId), enrol.deviceKey);
  check('accepts rollup', first.accepted.rollup === 1);
  check('accepts request', first.accepted.request === 1);
  check('accepts privacy', first.accepted.privacy === 1);
  check('drops nonsense kind', first.accepted.notice === 0 && first.duplicates === 0);

  const second = await post('/v1/batch', batch(enrol.deviceId, enrol.workspaceId), enrol.deviceKey);
  check('idempotent events', second.duplicates === 2 && second.accepted.request === 0);
  check('rollup upserts', second.accepted.rollup === 1);

  const stats = await fetch(base + '/v1/stats', { headers: { authorization: `Bearer ${enrol.deviceKey}` } }).then((r) => r.json());
  check('stats', stats.rollups === 1 && stats.request === 1 && stats.privacy === 1);

  server.close();
  console.log(fails === 0 ? 'all ingest cases pass' : `${fails} failures`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log('FAIL (exception):', e);
  process.exit(1);
});
