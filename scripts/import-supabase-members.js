// 멤버 -> members_admin 로 import (member_code = SOOP userId 로 upsert)
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-supabase-members.js --dry-run
//   ... --apply
const { runImport } = require("./_supabase-import-core");

// PC/모바일과 같은 CALM 명단 원본 사용
const SOURCE = require('../data/manual/calm-members.json').members.map(row => row.member);

const rows = SOURCE.map(function (m, i) {
  return {
    member_code: m.userId,
    name: m.name,
    race: m.race,
    tier: String(m.tier),
    role: m.role,
    soop_id: m.userId,
    youtube_url: m.youtube && m.youtube !== "#" ? m.youtube : null,
    profile_image: "https://stimg.sooplive.com/LOGO/" + m.userId.slice(0, 2) + "/" + m.userId + "/m/" + m.userId + ".webp",
    sort_order: i
  };
});

runImport({
  table: "members_admin",
  rows: rows,
  onConflict: "member_code",
  label: "members_admin"
}).catch(function (e) { console.error(e); process.exit(1); });
