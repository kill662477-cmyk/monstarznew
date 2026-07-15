const zlib = require("zlib");
const { getR2Config, normalizePrefix, putObject } = require("./client");

function recordObjectKey(bucket, objectPath) {
  const prefix = normalizePrefix(process.env.R2_TIER_RECORD_PREFIX || bucket || "tier-records");
  const path = normalizePrefix(objectPath);
  return prefix ? `${prefix}/${path}` : path;
}

function enabled() {
  return process.env.R2_TIER_RECORD_UPLOAD === "true" && getR2Config().ready;
}

async function uploadGzJson(bucket, objectPath, data) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
  const result = await putObject(recordObjectKey(bucket, objectPath), gz, {
    contentType: "application/gzip",
    cacheControl: "public, max-age=120",
  });
  return { size: gz.length, ...result };
}

module.exports = { enabled, recordObjectKey, uploadGzJson };
