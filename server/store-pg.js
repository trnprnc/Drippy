// Postgres store (Neon, UK/EU region). Same interface as store-memory.
// Requires DATABASE_URL and schema.sql applied.

const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

module.exports = {
  name: 'postgres',

  async ready() {
    await pool.query('select 1');
  },

  async enroll(kind, keyHash) {
    const workspaceId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into workspaces (id, kind) values ($1, $2)', [workspaceId, kind]);
      await c.query('insert into devices (id, workspace_id, key_hash) values ($1, $2, $3)', [deviceId, workspaceId, keyHash]);
      await c.query('commit');
    } catch (err) {
      await c.query('rollback');
      throw err;
    } finally {
      c.release();
    }
    return { workspaceId, deviceId };
  },

  async deviceByKeyHash(hash) {
    const { rows } = await pool.query('select id, workspace_id from devices where key_hash = $1', [hash]);
    return rows[0] ? { deviceId: rows[0].id, workspaceId: rows[0].workspace_id } : null;
  },

  async touchDevice(deviceId, meta) {
    await pool.query(
      `update devices set app_version = coalesce($2, app_version), os = coalesce($3, os),
         os_version = coalesce($4, os_version), factors_version = coalesce($5, factors_version),
         country = coalesce($6, country), last_seen_at = now() where id = $1`,
      [deviceId, meta.appVersion, meta.os, meta.osVersion, meta.factorsVersion, meta.country]
    );
  },

  async upsertRollup(deviceId, r) {
    await pool.query(
      `insert into rollups (device_id, date, tz_offset_min, requests, fg_requests, ai_seconds, wh, water_ml,
         gco2, usd, tokens_in, tokens_out, privacy_events, privacy_by_cat, apps, models, bytes_est_in, bytes_est_out, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
       on conflict (device_id, date) do update set
         tz_offset_min = excluded.tz_offset_min, requests = excluded.requests, fg_requests = excluded.fg_requests,
         ai_seconds = excluded.ai_seconds, wh = excluded.wh, water_ml = excluded.water_ml, gco2 = excluded.gco2,
         usd = excluded.usd, tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out,
         privacy_events = excluded.privacy_events, privacy_by_cat = excluded.privacy_by_cat, apps = excluded.apps,
         models = excluded.models, bytes_est_in = excluded.bytes_est_in, bytes_est_out = excluded.bytes_est_out,
         updated_at = now()`,
      [
        deviceId, r.date, r.tzOffsetMin, r.requests, r.fgRequests, r.aiSeconds, r.wh, r.waterMl,
        r.gco2, r.usd, r.tokensIn, r.tokensOut, r.privacyEvents, r.privacyByCat, r.apps, r.models,
        r.bytesEstIn, r.bytesEstOut,
      ]
    );
  },

  async insertEvent(deviceId, hash, r) {
    const { rowCount } = await pool.query(
      `insert into events (device_id, hash, ts, kind, app, fg, ms, basis, model, tier, tk, bytes,
         tokens_in, tokens_out, wh, fv, source, cats, top_tier, resolution, ms_to_clear, notice_id, family)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       on conflict (device_id, hash) do nothing`,
      [
        deviceId, hash, r.ts, r.kind, r.app ?? null, r.fg ?? null, r.ms ?? null, r.basis ?? null,
        r.model ?? null, r.tier ?? null, r.tk ?? null, r.bytes ?? null, r.in ?? null, r.out ?? null,
        r.wh ?? null, r.fv ?? null, r.source ?? null, r.cats ? JSON.stringify(r.cats) : null,
        r.topTier ?? null, r.resolution ?? null, r.msToClear ?? null, r.id ?? null, r.family ?? null,
      ]
    );
    return rowCount > 0;
  },

  async stats(deviceId) {
    const counts = { rollups: 0, request: 0, privacy: 0, notice: 0 };
    const r1 = await pool.query('select count(*)::int as n from rollups where device_id = $1', [deviceId]);
    counts.rollups = r1.rows[0].n;
    const r2 = await pool.query('select kind, count(*)::int as n from events where device_id = $1 group by kind', [deviceId]);
    for (const row of r2.rows) counts[row.kind] = row.n;
    return counts;
  },
};
