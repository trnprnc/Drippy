// In-memory store for development and tests. Same interface as store-pg.

const crypto = require('crypto');

const workspaces = new Map(); // id -> { kind }
const devices = new Map(); // id -> { workspaceId, keyHash, meta }
const byKeyHash = new Map(); // keyHash -> deviceId
const rollups = new Map(); // deviceId|date -> record
const events = new Map(); // deviceId|hash -> record

module.exports = {
  name: 'memory',
  ready: async () => {},

  async enroll(kind, keyHash) {
    const workspaceId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    workspaces.set(workspaceId, { kind });
    devices.set(deviceId, { workspaceId, keyHash, meta: {} });
    byKeyHash.set(keyHash, deviceId);
    return { workspaceId, deviceId };
  },

  async deviceByKeyHash(hash) {
    const deviceId = byKeyHash.get(hash);
    if (!deviceId) return null;
    return { deviceId, workspaceId: devices.get(deviceId).workspaceId };
  },

  async touchDevice(deviceId, meta) {
    const d = devices.get(deviceId);
    if (d) d.meta = { ...d.meta, ...meta, lastSeenAt: new Date().toISOString() };
  },

  async upsertRollup(deviceId, r) {
    rollups.set(`${deviceId}|${r.date}`, r);
  },

  async insertEvent(deviceId, hash, r) {
    const key = `${deviceId}|${hash}`;
    if (events.has(key)) return false;
    events.set(key, r);
    return true;
  },

  async stats(deviceId) {
    const counts = { rollups: 0, request: 0, privacy: 0, notice: 0 };
    for (const key of rollups.keys()) if (key.startsWith(deviceId)) counts.rollups += 1;
    for (const [key, r] of events) if (key.startsWith(deviceId)) counts[r.kind] += 1;
    return counts;
  },

  async close() {},
};
