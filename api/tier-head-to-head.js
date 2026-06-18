const { downloadGzJson, DEFAULT_BUCKET } = require("../lib/supabase/storage");
const admin = require("../lib/supabase/admin");
const {
  safeRecordKey,
  safePairKey,
  normalizeRows,
  summarizePair,
  dbRowToPeriods,
} = require("../lib/tier-head-to-head-summary");

function normalizePrefix(value) {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function recordPath(key) {
  const prefix = normalizePrefix(process.env.TIER_RECORD_STORAGE_PREFIX || "records");
  const fileName = safeRecordKey(key) + ".json.gz";
  return prefix ? prefix + "/" + fileName : fileName;
}

function recordPairKey(keyA, keyB) {
  return safePairKey([safeRecordKey(keyA), safeRecordKey(keyB)].join("__"));
}

function parsePair(pair) {
  const keyA = safeRecordKey(pair && pair.keyA);
  const keyB = safeRecordKey(pair && pair.keyB);
  return {
    responsePairKey: String((pair && pair.pairKey) || [keyA, keyB].join("||")).slice(0, 260),
    keyA,
    keyB,
    dbPairKey: recordPairKey(keyA, keyB),
    reverseDbPairKey: recordPairKey(keyB, keyA),
    playerA: {
      userId: String((pair && pair.userIdA) || "").trim(),
      name: String((pair && pair.nameA) || "").trim(),
      race: String((pair && pair.raceA) || "").trim().toUpperCase(),
    },
    playerB: {
      userId: String((pair && pair.userIdB) || "").trim(),
      name: String((pair && pair.nameB) || "").trim(),
      race: String((pair && pair.raceB) || "").trim().toUpperCase(),
    },
  };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function dbSummaryFor(pair) {
  if (!pair.dbPairKey || !pair.reverseDbPairKey) return null;
  const direct = pair.dbPairKey;
  const reverse = pair.reverseDbPairKey;
  const query =
    "?select=*&pair_key=in.(" +
    encodeURIComponent(direct) +
    "," +
    encodeURIComponent(reverse) +
    ")&limit=2";

  const rows = await admin.rest("GET", "tier_head_to_head_summaries", { query });
  const directRow = (rows || []).find((row) => row.pair_key === direct);
  if (directRow) return { periods: dbRowToPeriods(directRow, false), source: "supabase-db" };
  const reverseRow = (rows || []).find((row) => row.pair_key === reverse);
  if (reverseRow) return { periods: dbRowToPeriods(reverseRow, true), source: "supabase-db" };
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed", pairs: [] });

  try {
    const body = await readJsonBody(req);
    const pairs = (Array.isArray(body.pairs) ? body.pairs : [])
      .slice(0, 20)
      .map(parsePair)
      .filter((pair) => pair.keyA && pair.keyB);

    const bucket = process.env.TIER_RECORD_STORAGE_BUCKET || DEFAULT_BUCKET;
    const recordCache = new Map();
    let dbAvailable = true;

    async function recordsFor(key) {
      const safe = safeRecordKey(key);
      if (!safe) return [];
      if (!recordCache.has(safe)) {
        recordCache.set(safe, downloadGzJson(bucket, recordPath(safe)).then(normalizeRows));
      }
      return recordCache.get(safe);
    }

    async function resolvePair(pair) {
      if (dbAvailable) {
        try {
          const summary = await dbSummaryFor(pair);
          if (summary) {
            return {
              pairKey: pair.responsePairKey,
              periods: summary.periods,
              source: summary.source,
            };
          }
        } catch (error) {
          dbAvailable = false;
        }
      }

      const [rowsA, rowsB] = await Promise.all([recordsFor(pair.keyA), recordsFor(pair.keyB)]);
      return {
        pairKey: pair.responsePairKey,
        periods: summarizePair(rowsA, rowsB, pair.playerA, pair.playerB),
        source: "storage-fallback",
      };
    }

    const results = await Promise.all(pairs.map(resolvePair));
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json({ pairs: results });
  } catch (error) {
    if (error && error.code === "supabase_not_configured") {
      return res.status(503).json({ error: "supabase_not_configured", pairs: [] });
    }
    return res.status(500).json({ error: "tier_head_to_head_error", pairs: [] });
  }
};
