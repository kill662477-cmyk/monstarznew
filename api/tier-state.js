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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const snapshots = await readTierStateSnapshots(SNAPSHOT_KEYS);
    const meta = Object.assign(
      {},
      snapshotPayload(snapshots, "meta", {}),
      snapshotPayload(snapshots, "liveMeta", {})
    );
    const players = normalizeList(snapshotPayload(snapshots, "players", []));
    const liveStatus = snapshotPayload(snapshots, "liveStatus", {});
    const winRates = snapshotPayload(snapshots, "winRates", {});
    const recordMeta = snapshotPayload(snapshots, "recordMeta", {});
    const updatedAt =
      (snapshots.meta && snapshots.meta.updatedAt) ||
      (snapshots.players && snapshots.players.updatedAt) ||
      (snapshots.liveStatus && snapshots.liveStatus.updatedAt) ||
      null;

    res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=180");
    return res.status(200).json({
      source: "supabase",
      updatedAt,
      meta,
      players,
      liveStatus,
      winRates,
      recordMeta,
    });
  } catch (error) {
    if (error && error.code === "supabase_not_configured") {
      return res.status(503).json({ error: "supabase_not_configured" });
    }
    return res.status(500).json({ error: "tier_state_error" });
  }
};
