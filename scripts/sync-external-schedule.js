// 외부 일정표(tscam-schedule, Netlify 배포) 동기화.
//
// 원본 편집은 계속 https://monumental-dolphin-3ac88f.netlify.app (= tscam-schedule 레포)에서
// 하고, 이 스크립트는 그 레포의 data/schedule.json을 읽기 전용으로 가져와
// Supabase external_schedule_sync 테이블(단일 행)에 그대로 미러링한다.
// tscam-schedule 레포/코드는 전혀 건드리지 않는다.
//
// adminPasswordHash 등 민감 필드는 절대 가져오지 않고 weekly/today/monthly만 동기화한다.

const SOURCE_URL =
  "https://raw.githubusercontent.com/kill662477-cmyk/tscam-schedule/main/data/schedule.json";

function getServerConfig() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return { url: url.replace(/\/+$/, ""), serviceKey };
}

async function fetchSourceSchedule() {
  const res = await fetch(SOURCE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`tscam-schedule fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  const data = json && json.data ? json.data : {};
  return {
    weekly: data.weekly && typeof data.weekly === "object" ? data.weekly : {},
    today: data.today && typeof data.today === "object" ? data.today : {},
    monthly: data.monthly && typeof data.monthly === "object" ? data.monthly : {},
  };
}

async function upsertScheduleMirror(cfg, payload) {
  const body = Object.assign({ id: "tscam" }, payload, {
    synced_at: new Date().toISOString(),
  });
  const res = await fetch(
    `${cfg.url}/rest/v1/external_schedule_sync?on_conflict=id`,
    {
      method: "POST",
      headers: {
        apikey: cfg.serviceKey,
        Authorization: "Bearer " + cfg.serviceKey,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(body),
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase upsert failed: HTTP ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const cfg = getServerConfig();
  const schedule = await fetchSourceSchedule();
  console.log(
    `[sync-external-schedule] fetched: weekly keys=${Object.keys(schedule.weekly).length}, ` +
      `today.schedule=${schedule.today.schedule ? "yes" : "no"}, monthly entries=${
        Object.keys(schedule.monthly).length
      }`
  );
  await upsertScheduleMirror(cfg, schedule);
  console.log("[sync-external-schedule] synced to Supabase external_schedule_sync");
}

main().catch((error) => {
  console.error("[sync-external-schedule] failed:", error.message || error);
  process.exit(1);
});
