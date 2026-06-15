const DATABASE_URL = (
  process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app"
).replace(/\/+$/, "");
const RANK_ROOT = process.env.SURVIVORS_RANK_ROOT || "starcraftTier/current/survivorsRankings";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

function cleanRows(value) {
  return Object.entries(value || {})
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter((row) => Number(row.score || 0) > 0)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 10);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const response = await fetch(`${DATABASE_URL}/${RANK_ROOT}.json`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error((data && data.error) || `Realtime Database HTTP ${response.status}`);
    return res.status(200).json({ ok: true, rankings: cleanRows(data) });
  } catch (err) {
    return res.status(500).json({
      error: "ranking_read_failed",
      message: err.message || String(err),
    });
  }
}
