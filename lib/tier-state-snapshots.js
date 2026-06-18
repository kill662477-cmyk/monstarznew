const admin = require("./supabase/admin");

const SNAPSHOT_KEYS = ["meta", "players", "liveStatus", "winRates", "recordMeta", "liveMeta"];

function normalizeKey(key) {
  return String(key || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function payloadFor(value) {
  if (value === undefined || value === null) return {};
  return value;
}

async function upsertTierStateSnapshots(snapshots, source) {
  const rows = Object.entries(snapshots || {})
    .map(([key, value]) => ({
      snapshot_key: normalizeKey(key),
      payload: payloadFor(value),
      source: String(source || "unknown").slice(0, 120),
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => row.snapshot_key);

  if (!rows.length) return { attempted: 0, succeeded: 0 };

  await admin.rest("POST", "tier_state_snapshots", {
    query: "?on_conflict=snapshot_key",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });

  return { attempted: rows.length, succeeded: rows.length };
}

async function readTierStateSnapshots(keys = SNAPSHOT_KEYS) {
  const cleanKeys = Array.from(new Set(keys.map(normalizeKey).filter(Boolean)));
  if (!cleanKeys.length) return {};

  const query =
    "?select=snapshot_key,payload,updated_at,source&snapshot_key=in.(" +
    cleanKeys.map(encodeURIComponent).join(",") +
    ")";
  const rows = await admin.rest("GET", "tier_state_snapshots", { query });
  const out = {};

  (rows || []).forEach((row) => {
    if (!row || !row.snapshot_key) return;
    out[row.snapshot_key] = {
      payload: row.payload,
      updatedAt: row.updated_at,
      source: row.source,
    };
  });

  return out;
}

function snapshotPayload(snapshots, key, fallback) {
  const item = snapshots && snapshots[key];
  return item && item.payload !== undefined && item.payload !== null ? item.payload : fallback;
}

module.exports = {
  SNAPSHOT_KEYS,
  upsertTierStateSnapshots,
  readTierStateSnapshots,
  snapshotPayload,
};
