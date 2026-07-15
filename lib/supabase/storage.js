// 서버 전용 Supabase Storage 헬퍼 (gzip JSON 업/다운로드). 브라우저에서 import 금지.
// 전적 원본을 DB row가 아니라 Storage 의 .json.gz 파일로 저장/조회합니다.
// service/secret 키로만 동작하며 비공개 버킷을 사용합니다.

const zlib = require("zlib");
const { getServerConfig } = require("./server");

const DEFAULT_BUCKET = "tier-records";

function ensure() {
  const cfg = getServerConfig();
  if (!cfg.ready) {
    const err = new Error("Supabase 환경변수가 설정되지 않았습니다.");
    err.code = "supabase_not_configured";
    err.status = 503;
    throw err;
  }
  return cfg;
}

function headers(cfg, extra) {
  return Object.assign({
    apikey: cfg.serviceKey,
    Authorization: "Bearer " + cfg.serviceKey
  }, extra || {});
}

// 버킷 생성(이미 있으면 무시). public:false (비공개)
async function ensureBucket(bucket) {
  bucket = bucket || DEFAULT_BUCKET;
  const cfg = ensure();
  const res = await fetch(cfg.url + "/storage/v1/bucket", {
    method: "POST",
    headers: headers(cfg, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: bucket, name: bucket, public: false })
  });
  if (res.status === 409) return { created: false, existed: true };
  const text = await res.text();
  if (!res.ok) {
    // 이미 존재 등은 통과
    if (/already exists/i.test(text)) return { created: false, existed: true };
    const err = new Error("bucket_create_failed: " + text.slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return { created: true, existed: false };
}

// 객체 JSON -> gzip -> 업로드 (upsert)
async function uploadGzJson(bucket, objectPath, data) {
  const cfg = ensure();
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
  const res = await fetch(cfg.url + "/storage/v1/object/" + bucket + "/" + objectPath, {
    method: "POST",
    headers: headers(cfg, {
      "Content-Type": "application/gzip",
      "Cache-Control": "max-age=60",
      "x-upsert": "true"
    }),
    body: gz
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error("upload_failed: " + text.slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return { size: gz.length };
}

// 다운로드 -> gunzip -> JSON 파싱. 없으면 null.
async function downloadGzJson(bucket, objectPath) {
  const r2BaseUrl = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (r2BaseUrl) {
    const prefix = String(process.env.R2_TIER_RECORD_PREFIX || bucket || DEFAULT_BUCKET)
      .replace(/^\/+|\/+$/g, "");
    const path = String(objectPath || "").replace(/^\/+/, "");
    const r2Url = `${r2BaseUrl}/${prefix}/${path}`;
    const r2Response = await fetch(r2Url);
    if (r2Response.ok) {
      return parseGzipJson(Buffer.from(await r2Response.arrayBuffer()));
    }
    if (r2Response.status !== 404) {
      const err = new Error("r2_download_failed_" + r2Response.status);
      err.status = r2Response.status;
      throw err;
    }
  }

  const cfg = ensure();
  const res = await fetch(cfg.url + "/storage/v1/object/" + bucket + "/" + objectPath, {
    method: "GET",
    headers: headers(cfg)
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    const err = new Error("download_failed_" + res.status);
    err.status = res.status;
    throw err;
  }
  return parseGzipJson(Buffer.from(await res.arrayBuffer()));
}

function parseGzipJson(buf) {
  let raw;
  try {
    raw = zlib.gunzipSync(buf);
  } catch (e) {
    // 혹시 비압축으로 저장된 경우 그대로 파싱 시도
    raw = buf;
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch (e) {
    return null;
  }
}

module.exports = { ensureBucket, uploadGzJson, downloadGzJson, DEFAULT_BUCKET };
