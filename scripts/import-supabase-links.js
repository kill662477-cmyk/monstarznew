// 외부 링크 -> external_links 로 import
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-supabase-links.js --dry-run
//   ... --apply
const { runImport } = require("./_supabase-import-core");

// index.html 의 EXTERNAL_LINKS 와 동일한 원본 (수동 동기화)
const SOURCE = [
  { title: "CALM HOXY", url: "https://calm-hoxy.vercel.app/", category: "캄몬 관련 외부 페이지" },
  { title: "ELOBOARD", url: "https://eloboard.com/", category: "전적/랭킹 확인" },
  { title: "모의고사", url: "https://machugi.io/quiz/GJQTMpLt4usVzZyeGMJO", category: "캄몬스타즈 퀴즈" },
  { title: "일정표", url: "https://tscam-schedule-kill662477-cmyks-projects.vercel.app/", category: "외부 일정표" },
  { title: "그것이알고싶캄몬", url: "https://fmcalm.vercel.app/", category: "팬 제작 자료" },
  { title: "손실바 방송국", url: "https://www.sooplive.com/station/silver0love", category: "made by 손실바" }
];

const rows = SOURCE.map(function (l, i) {
  return { title: l.title, url: l.url, category: l.category, note: l.category, sort_order: i };
});

runImport({
  table: "external_links",
  rows: rows,
  matchKey: function (r) { return r.url; },
  label: "external_links"
}).catch(function (e) { console.error(e); process.exit(1); });
