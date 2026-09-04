// 멤버 -> members_admin 로 import (member_code = SOOP userId 로 upsert)
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-supabase-members.js --dry-run
//   ... --apply
const { runImport } = require("./_supabase-import-core");

// index.html 의 MEMBERS 와 동일한 원본 (수동 동기화)
const SOURCE = [
  { name: "김윤환", userId: "brainzerg7", role: "감독", tier: "Jack", race: "Zerg", youtube: "http://www.youtube.com/@calmtube2" },
  { name: "사테", userId: "hoonykkk", role: "코치", tier: "King", race: "Terran" },
  { name: "박준오", userId: "h78ert", role: "코치", tier: "King", race: "Zerg" },
  { name: "배성흠", userId: "goodzerg", role: "코치", tier: "Jack", race: "Zerg" },
  { name: "파도튜브", userId: "kthrs9207", role: "코치", tier: "Spade", race: "Protoss" },
  { name: "김민철", userId: "minchul", role: "코치", tier: "God", race: "Zerg" },
  { name: "토마토", userId: "freshtomato", role: "학생", tier: "3", race: "Protoss", youtube: "https://www.youtube.com/channel/UCoBw6khRoeei_tgSBueVUXw" },
  { name: "지두두", userId: "wjswlgns09", role: "학생", tier: "3", race: "Terran" },
  { name: "햇살", userId: "thelddl", role: "학생", tier: "4", race: "Terran" },
  { name: "주하랑", userId: "fpahsdltu1", role: "학생", tier: "5", race: "Protoss" },
  { name: "소주양", userId: "soju2022", role: "학생", tier: "5", race: "Terran" },
  { name: "임조이", userId: "dlaguswl501", role: "학생", tier: "6", race: "Zerg" },
  { name: "비타밍", userId: "seemin88", role: "학생", tier: "6", race: "Terran" },
  { name: "먼진", userId: "2meonjin", role: "학생", tier: "7", race: "Zerg" },
  { name: "아리송이", userId: "vldpfm2", role: "학생", tier: "7", race: "Protoss" },
  { name: "진땅콩", userId: "wlswn6565", role: "학생", tier: "8", race: "Protoss" },
  { name: "낭니", userId: "sksmsskdsl10", role: "학생", tier: "9", race: "Zerg" }
];

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
