// Drippy ingest — Phase 1 (DATA-STORAGE.md). One endpoint in, typed rows
// out. Records are rebuilt through whitelists at the door and unknown
// fields are dropped, so the store has no column that could hold content.
//
// Run:  DB=memory node ingest.js                          (development)
//       DATABASE_URL=postgres://… node ingest.js          (Neon)
// Port: PORT (default 8787).
//
// Endpoints:
//   GET  /v1/health              → { ok, db }
//   POST /v1/enroll              → { workspaceId, deviceId, deviceKey }
//        { workspaceKind: 'personal' }   (org enrolment arrives with MDM)
//   POST /v1/batch  Bearer <key> → { ok, accepted, duplicates }
//   GET  /v1/stats  Bearer <key> → this device's own row counts

require('./env');
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY = 2 * 1024 * 1024;
const MAX_RECORDS = 1000;

const store = process.env.DATABASE_URL ? require('./store-pg') : require('./store-memory');

const keyHash = (key) => crypto.createHash('sha256').update(key).digest('hex');

// --- record whitelists (mirror of the device's sync.js shapes) -----------

const num = (v) => (Number.isFinite(v) ? v : 0);
const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : null);
// Maps of short labels to numbers (apps, models, privacyByCat). Values are
// numbers or small {requests, wh, ...} objects of numbers; anything else
// is dropped.
function numMap(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 1) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 60)) {
    const key = String(k).slice(0, 80);
    if (Number.isFinite(v)) out[key] = v;
    else if (v && typeof v === 'object') {
      const inner = {};
      for (const [ik, iv] of Object.entries(v).slice(0, 12)) if (Number.isFinite(iv)) inner[String(ik).slice(0, 20)] = iv;
      out[key] = inner;
    }
  }
  return out;
}

function sanitizeRollup(r) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return null;
  return {
    kind: 'rollup',
    date: r.date,
    tzOffsetMin: num(r.tzOffsetMin),
    requests: num(r.requests),
    fgRequests: num(r.fgRequests),
    aiSeconds: num(r.aiSeconds),
    wh: num(r.wh),
    waterMl: num(r.waterMl),
    gco2: num(r.gco2),
    usd: num(r.usd),
    tokensIn: num(r.tokensIn),
    tokensOut: num(r.tokensOut),
    privacyEvents: num(r.privacyEvents),
    privacyByCat: numMap(r.privacyByCat),
    apps: numMap(r.apps),
    models: numMap(r.models),
    bytesEstIn: num(r.bytesEstIn),
    bytesEstOut: num(r.bytesEstOut),
  };
}

function sanitizeEvent(r) {
  if (typeof r.ts !== 'string' || isNaN(Date.parse(r.ts))) return null;
  if (r.kind === 'request') {
    return {
      kind: 'request',
      ts: r.ts,
      app: str(r.app, 80) || '',
      fg: !!r.fg,
      ms: num(r.ms),
      basis: r.basis === 'measured' ? 'measured' : 'estimated',
      model: str(r.model, 80),
      tier: r.tier == null ? null : num(r.tier),
      tk: r.tk ? { in: num(r.tk.in), cw: num(r.tk.cw), cr: num(r.tk.cr), out: num(r.tk.out) } : null,
      bytes: r.bytes ? { in: num(r.bytes.in), out: num(r.bytes.out) } : null,
      in: num(r.in),
      out: num(r.out),
      wh: num(r.wh),
      fv: str(r.fv, 20),
    };
  }
  if (r.kind === 'privacy') {
    const cats = Array.isArray(r.cats)
      ? r.cats.slice(0, 12).map((c) => ({ id: str(c && c.id, 40) || 'unknown', tier: c && c.tier != null ? num(c.tier) : null }))
      : [];
    return {
      kind: 'privacy',
      ts: r.ts,
      source: str(r.source, 20),
      cats,
      topTier: r.topTier == null ? null : num(r.topTier),
      resolution: str(r.resolution, 30),
      msToClear: r.msToClear == null ? null : num(r.msToClear),
    };
  }
  if (r.kind === 'notice') {
    return { kind: 'notice', ts: r.ts, id: str(r.id, 40) || '', family: str(r.family, 20) };
  }
  return null;
}

// --- http plumbing --------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function authDevice(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  return store.deviceByKeyHash(keyHash(m[1]));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/v1/health') {
      return send(res, 200, { ok: true, db: store.name });
    }

    if (req.method === 'POST' && req.url === '/v1/enroll') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.workspaceKind !== 'personal') {
        return send(res, 400, { error: 'only personal workspaces enrol here for now' });
      }
      const deviceKey = crypto.randomBytes(32).toString('hex');
      const out = await store.enroll('personal', keyHash(deviceKey));
      console.log(`[ingest] enrolled device ${out.deviceId} in ${out.workspaceId}`);
      return send(res, 200, { ...out, deviceKey });
    }

    if (req.method === 'POST' && req.url === '/v1/batch') {
      const device = await authDevice(req);
      if (!device) return send(res, 401, { error: 'unknown device' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const records = Array.isArray(body.records) ? body.records.slice(0, MAX_RECORDS) : [];
      const env = body.envelope || {};
      await store.touchDevice(device.deviceId, {
        appVersion: str(env.appVersion, 20),
        os: str(env.os, 20),
        osVersion: str(env.osVersion, 20),
        factorsVersion: str(env.factorsVersion, 20),
        country: str(env.country, 8),
      });
      const accepted = { rollup: 0, request: 0, privacy: 0, notice: 0 };
      let duplicates = 0;
      for (const raw of records) {
        if (raw && raw.kind === 'rollup') {
          const r = sanitizeRollup(raw);
          if (!r) continue;
          await store.upsertRollup(device.deviceId, r);
          accepted.rollup += 1;
        } else if (raw && (raw.kind === 'request' || raw.kind === 'privacy' || raw.kind === 'notice')) {
          const r = sanitizeEvent(raw);
          if (!r) continue;
          // Dedupe on the sanitised content, not the client's claim.
          const hash = crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
          const inserted = await store.insertEvent(device.deviceId, hash, r);
          if (inserted) accepted[r.kind] += 1;
          else duplicates += 1;
        }
      }
      console.log(`[ingest] batch from ${device.deviceId}: ${JSON.stringify(accepted)}, ${duplicates} duplicates`);
      return send(res, 200, { ok: true, accepted, duplicates });
    }

    if (req.method === 'GET' && req.url === '/v1/stats') {
      const device = await authDevice(req);
      if (!device) return send(res, 401, { error: 'unknown device' });
      return send(res, 200, await store.stats(device.deviceId));
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, err.status || 500, { error: String(err.message || err).slice(0, 200) });
  }
});

if (require.main === module) {
  store.ready().then(() => {
    server.listen(PORT, () => console.log(`[ingest] listening on :${PORT} (${store.name})`));
  });
}

module.exports = { server, store, sanitizeRollup, sanitizeEvent };
