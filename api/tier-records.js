// 전적 원본 조회 API: Storage 의 records/<key>.json.gz 를 service key로 받아
// 압축 해제한 JSON 만 브라우저에 돌려줍니다. (service key 는 절대 노출되지 않음)
// GET /api/tier-records?key=<userId>_<race>
const { downloadGzJson, DEFAULT_BUCKET } = require("../lib/supabase/storage");

function safeKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function normalizePrefix(value) {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function recordPath(key) {
  const prefix = normalizePrefix(process.env.TIER_RECORD_STORAGE_PREFIX || "records");
  const fileName = safeKey(key) + ".json.gz";
  return prefix ? prefix + "/" + fileName : fileName;
}

function rowDate(row) {
  return String((row && (row.date || row.standardDate || row.playedAt || row.createdAt)) || "").slice(0, 10);
}

function rowTime(row) {
  const date = rowDate(row).replace(/[./]/g, "-");
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return 0;
  const time = new Date(date.slice(0, 10) + "T00:00:00+09:00").getTime();
  return Number.isFinite(time) ? time : 0;
}

function filterRecentRows(data, days) {
  if (!Array.isArray(data) || !days) return data;
  const cutoff = Date.now() - days * 86400000;
  return data.filter((row) => {
    const time = rowTime(row);
    return time && time >= cutoff;
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const key = safeKey(req.query && req.query.key);
  if (!key) return res.status(400).json({ error: "missing_key" });

  try {
    const bucket = process.env.TIER_RECORD_STORAGE_BUCKET || DEFAULT_BUCKET;
    const days = Math.max(0, Math.min(3650, Number(req.query && req.query.days) || 0));
    const data = await downloadGzJson(bucket, recordPath(key));
    if (data === null) {
      res.setHeader("Cache-Control", "s-maxage=30");
      return res.status(404).json({ key: key, data: null, isEmpty: true, error: "not_found" });
    }
    const filtered = filterRecentRows(data, days);
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json({
      key: key,
      data: filtered,
      isEmpty: Array.isArray(filtered) ? filtered.length === 0 : !filtered,
      totalCount: Array.isArray(data) ? data.length : null,
      filteredCount: Array.isArray(filtered) ? filtered.length : null,
      days: days || null
    });
  } catch (e) {
    if (e && e.code === "supabase_not_configured") {
      return res.status(503).json({ error: "supabase_not_configured", key: key, data: null, isEmpty: true });
    }
    return res.status(500).json({ error: "tier_records_error", key: key, data: null, isEmpty: true });
  }
};
