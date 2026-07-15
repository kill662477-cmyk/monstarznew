const {
  SNAPSHOT_KEYS,
  readTierStateSnapshots,
  snapshotPayload,
} = require("../lib/tier-state-snapshots");

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.players)) return value.players;
  if (Array.isArray(value.data)) return value.data;
  return Object.values(value);
}

function r2ObjectUrl(name) {
  const base = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const prefix = String(process.env.R2_TIER_STATE_PREFIX || "tier-state")
    .replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${prefix}/${name}.json` : "";
}

async function readR2TierState() {
  const coreUrl = r2ObjectUrl("core");
  if (!coreUrl) return null;

  const [coreResponse, liveResponse] = await Promise.all([
    fetch(coreUrl),
    fetch(r2ObjectUrl("live")),
  ]);
  if (!coreResponse.ok) throw new Error(`r2_core_${coreResponse.status}`);

  const core = await coreResponse.json();
  const live = liveResponse.ok ? await liveResponse.json() : {};
  return {
    source: "r2",
    updatedAt: live.updatedAt || core.updatedAt || null,
    meta: Object.assign({}, core.meta || {}, live.liveMeta || {}),
    players: normalizeList(core.players),
    liveStatus: live.liveStatus || {},
    winRates: core.winRates || {},
    // Kept for frontend compatibility. Full record metadata is not needed by the board.
    recordMeta: {},
  };
}

async function readSupabaseTierState() {
  const snapshots = await readTierStateSnapshots(SNAPSHOT_KEYS);
  return {
    source: "supabase",
    updatedAt:
      (snapshots.meta && snapshots.meta.updatedAt) ||
      (snapshots.players && snapshots.players.updatedAt) ||
      (snapshots.liveStatus && snapshots.liveStatus.updatedAt) ||
      null,
    meta: Object.assign(
      {},
      snapshotPayload(snapshots, "meta", {}),
      snapshotPayload(snapshots, "liveMeta", {})
    ),
    players: normalizeList(snapshotPayload(snapshots, "players", [])),
    liveStatus: snapshotPayload(snapshots, "liveStatus", {}),
    winRates: snapshotPayload(snapshots, "winRates", {}),
    recordMeta: {},
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    let payload = null;
    try {
      payload = await readR2TierState();
    } catch (error) {
      console.warn("[tier-state] R2 fallback:", error.message);
    }
    if (!payload) payload = await readSupabaseTierState();

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(payload);
  } catch (error) {
    if (error && error.code === "supabase_not_configured") {
      return res.status(503).json({ error: "supabase_not_configured" });
    }
    return res.status(500).json({ error: "tier_state_error" });
  }
};
