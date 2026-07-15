const { getR2Config, normalizePrefix, putJson } = require("./client");

function objectKey(name) {
  const prefix = normalizePrefix(process.env.R2_TIER_STATE_PREFIX || "tier-state");
  return prefix ? `${prefix}/${name}.json` : `${name}.json`;
}

function enabled() {
  return process.env.R2_TIER_STATE_UPLOAD === "true" && getR2Config().ready;
}

async function uploadCore(payload, source = "collect-data") {
  const updatedAt = new Date().toISOString();
  const core = {
    version: 1,
    source,
    updatedAt,
    meta: payload.meta || {},
    players: payload.players || [],
    winRates: payload.winRates || {},
  };
  const recordMeta = {
    version: 1,
    source,
    updatedAt,
    recordMeta: payload.recordMeta || {},
  };
  const [coreResult, recordMetaResult] = await Promise.all([
    putJson(objectKey("core"), core, { cacheControl: "public, max-age=120" }),
    putJson(objectKey("record-meta"), recordMeta, { cacheControl: "public, max-age=300" }),
  ]);
  return { attempted: 2, succeeded: 2, coreResult, recordMetaResult };
}

async function uploadLive(liveStatus, liveMeta, source = "sync-soop-live") {
  const value = {
    version: 1,
    source,
    updatedAt: new Date().toISOString(),
    liveStatus: liveStatus || {},
    liveMeta: liveMeta || {},
  };
  const result = await putJson(objectKey("live"), value, {
    cacheControl: "public, max-age=60",
  });
  return { attempted: 1, succeeded: 1, result };
}

module.exports = { enabled, objectKey, uploadCore, uploadLive };
