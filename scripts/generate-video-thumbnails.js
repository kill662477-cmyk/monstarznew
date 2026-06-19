// 직접 영상(.mp4 등) 중 thumbnail 이 비어 있는 videos 행의 첫 프레임을 ffmpeg 로 떠서
// Supabase Storage(공개 버킷)에 올리고 videos.thumbnail 을 채운다.
//
// 왜 필요한가: fmkorea 등 외부 직접영상은 핫링크 보호로 브라우저 <video> 썸네일이
// 간헐 실패→재시도하며 깜빡인다. 서버(referer 헤더 포함)에서 한 번 프레임을 떠
// 정적 이미지로 저장하면 프런트는 안정적인 <img> 로 표시한다.
//
// 환경변수:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (필수)
//   VIDEO_THUMB_BUCKET (기본 video-thumbnails), VIDEO_THUMB_REFERER (기본 fmkorea)
//   FFMPEG_PATH (기본 ffmpeg), VIDEO_THUMB_FORCE=1 이면 기존 썸네일도 재생성

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
const BUCKET = (process.env.VIDEO_THUMB_BUCKET || "video-thumbnails").trim();
const FFMPEG = (process.env.FFMPEG_PATH || "ffmpeg").trim();
const REFERER = (process.env.VIDEO_THUMB_REFERER || "https://www.fmkorea.com/").trim();
const FORCE = process.env.VIDEO_THUMB_FORCE === "1";

const DIRECT_RE = /\.(mp4|webm|mov|m4v)(?:$|[?#])/i;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[thumb] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  process.exit(1);
}

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function api(pathname, init = {}) {
  return fetch(`${SUPABASE_URL}${pathname}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
}

async function ensureBucket() {
  const res = await api(`/storage/v1/bucket/${encodeURIComponent(BUCKET)}`);
  if (res.ok) return;
  const create = await api(`/storage/v1/bucket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (!create.ok && create.status !== 409) {
    throw new Error(`bucket create ${create.status}: ${await create.text()}`);
  }
  console.log(`[thumb] 공개 버킷 준비됨: ${BUCKET}`);
}

async function listTargets() {
  const res = await api(`/rest/v1/videos?select=id,title,url,thumbnail&is_visible=eq.true`);
  if (!res.ok) throw new Error(`videos read ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.filter((r) => {
    const url = String(r.url || "").split("#")[0];
    const hasThumb = Boolean(r.thumbnail && String(r.thumbnail).trim());
    return DIRECT_RE.test(url) && (FORCE || !hasThumb);
  });
}

function extractFrame(url, outPath) {
  execFileSync(
    FFMPEG,
    [
      "-headers", `Referer: ${REFERER}\r\n`,
      "-ss", "0.5",
      "-i", url,
      "-frames:v", "1",
      "-vf", "scale=480:-1",
      "-q:v", "4",
      "-update", "1",
      "-y", outPath,
    ],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 90000 }
  );
}

async function upload(objectPath, buf) {
  const res = await api(`/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: buf,
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

async function setThumbnail(id, thumbUrl) {
  const res = await api(`/rest/v1/videos?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ thumbnail: thumbUrl }),
  });
  if (!res.ok) throw new Error(`videos update ${res.status}: ${await res.text()}`);
}

async function main() {
  await ensureBucket();
  const targets = await listTargets();
  console.log(`[thumb] 대상 ${targets.length}건${FORCE ? " (FORCE 재생성)" : ""}`);
  if (!targets.length) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vthumb-"));
  let ok = 0;
  let fail = 0;

  for (const row of targets) {
    const out = path.join(tmpDir, `${row.id}.jpg`);
    try {
      extractFrame(row.url, out);
      const buf = fs.readFileSync(out);
      if (!buf.length) throw new Error("빈 프레임");
      const publicUrl = await upload(`videos/${row.id}.jpg`, buf);
      await setThumbnail(row.id, publicUrl);
      ok += 1;
      console.log(`[ok] ${row.title} -> ${publicUrl}`);
    } catch (error) {
      fail += 1;
      console.warn(`[fail] ${row.title} (${row.url}): ${String(error.message).slice(0, 200)}`);
    } finally {
      try { fs.unlinkSync(out); } catch (_) {}
    }
  }

  try { fs.rmdirSync(tmpDir); } catch (_) {}
  console.log(`[thumb] 완료 — 성공 ${ok}, 실패 ${fail}`);
  if (ok === 0) process.exit(1);
}

main().catch((error) => {
  console.error("[thumb]", error);
  process.exit(1);
});
