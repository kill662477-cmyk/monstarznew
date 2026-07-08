// IN&OUT 이력 -> inout_events 로 import
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-supabase-inout.js --dry-run
//   ... --apply
const { runImport } = require("./_supabase-import-core");

// index.html 의 INOUT_HISTORY 와 동일한 원본 (수동 동기화)
const INOUT_HISTORY = [
  { date: "24.07.08", events: [{ name: "김윤환", race: "Z", status: "IN" }, { name: "이경민", race: "P", status: "IN" }] },
  { date: "24.07.09", events: [{ name: "졈니", race: "P", status: "IN" }, { name: "디임", race: "P", status: "IN" }] },
  { date: "24.07.12", events: [{ name: "앵지", race: "Z", status: "IN" }] },
  { date: "24.07.17", events: [{ name: "토마토", race: "P", status: "IN" }, { name: "임조이", race: "Z", status: "IN" }] },
  { date: "24.07.20", events: [{ name: "킹지", race: "P", status: "IN" }, { name: "킹지", race: "P", status: "OUT" }] },
  { date: "24.08.07", events: [{ name: "효짱", race: "P", status: "IN" }, { name: "한쪼니", race: "P", status: "IN" }] },
  { date: "24.08.17", events: [{ name: "모리", race: "T", status: "IN" }, { name: "몽군", race: "T", status: "IN" }] },
  { date: "24.08.19", events: [{ name: "치리", race: "Z", status: "IN" }] },
  { date: "24.09.01", events: [{ name: "강덕구", race: "T", status: "IN" }] },
  { date: "24.09.25", events: [{ name: "강덕구", race: "T", status: "OUT" }] },
  { date: "24.09.30", events: [{ name: "수입뿌드", race: "P", status: "IN" }] },
  { date: "24.10.18", events: [{ name: "박준오", race: "Z", status: "IN" }] },
  { date: "24.10.31", events: [{ name: "정윤종", race: "P", status: "IN" }] },
  { date: "24.11.02", events: [{ name: "세나", race: "Z", status: "IN" }] },
  { date: "25.01.08", events: [{ name: "디임", race: "P", status: "OUT" }] },
  { date: "25.02.28", events: [{ name: "다예", race: "Z", status: "IN" }] },
  { date: "25.03.06", events: [{ name: "막내현진", race: "P", status: "IN" }, { name: "송혜림", race: "T", status: "IN" }, { name: "진땅콩", race: "T", status: "IN" }] },
  { date: "25.03.07", events: [{ name: "진땅콩", race: "T", status: "OUT" }] },
  { date: "25.06.12", events: [{ name: "송혜림", race: "T", status: "OUT" }] },
  { date: "25.07.14", events: [{ name: "세나", race: "Z", status: "OUT" }, { name: "앵지", race: "Z", status: "OUT" }, { name: "졈니", race: "P", status: "OUT" }, { name: "몽군", race: "T", status: "OUT" }, { name: "효짱", race: "P", status: "OUT" }, { name: "한쪼니", race: "P", status: "OUT" }] },
  { date: "25.07.26", events: [{ name: "황병영", race: "T", status: "IN" }, { name: "지동원", race: "T", status: "IN" }] },
  { date: "25.07.27", events: [{ name: "진땅콩", race: "P", status: "IN" }] },
  { date: "25.08.04", events: [{ name: "두디", race: "Z", status: "IN" }, { name: "조일장", race: "Z", status: "IN" }] },
  { date: "25.08.05", events: [{ name: "주하랑", race: "P", status: "IN" }] },
  { date: "25.08.07", events: [{ name: "햇살", race: "T", status: "IN" }] },
  { date: "25.09.24", events: [{ name: "소주양", race: "T", status: "IN" }] },
  { date: "25.10.30", events: [{ name: "두디", race: "Z", status: "OUT" }, { name: "모리", race: "T", status: "OUT" }, { name: "막내현진", race: "P", status: "OUT" }] },
  { date: "25.11.03", events: [{ name: "파도튜브", race: "P", status: "IN" }] },
  { date: "25.12.05", events: [{ name: "박쭈이", race: "Z", status: "IN" }] },
  { date: "26.01.14", events: [{ name: "정윤종", race: "P", status: "OUT" }] },
  { date: "26.01.17", events: [{ name: "박수범", race: "P", status: "IN" }, { name: "배성흠", race: "Z", status: "IN" }, { name: "먼진", race: "Z", status: "IN" }, { name: "다예", race: "Z", status: "OUT" }] },
  { date: "26.03.14", events: [{ name: "조일장", race: "Z", status: "OUT" }, { name: "황병영", race: "T", status: "OUT" }, { name: "수뿌", race: "P", status: "OUT" }] },
  { date: "26.03.16", events: [{ name: "비타밍", race: "T", status: "IN" }] },
  { date: "26.03.19", events: [{ name: "지두두", race: "T", status: "IN" }, { name: "아리송이", race: "P", status: "IN" }] },
  { date: "26.03.21", events: [{ name: "박쭈이", race: "Z", status: "OUT" }] },
  { date: "26.03.26", events: [{ name: "사테", race: "T", status: "IN" }, { name: "찌킹", race: "Z", status: "IN" }] },
  { date: "26.04.28", events: [{ name: "낭니", race: "Z", status: "IN" }] },
  { date: "26.05.04", events: [{ name: "이경민", race: "P", status: "OUT" }] },
  { date: "26.06.13", events: [{ name: "변현제", race: "P", status: "IN" }] },
  { date: "26.06.16", events: [{ name: "김민철", race: "Z", status: "IN" }]},
  { date: "26.06.27", events: [{ name: "진땅콩", race: "P", status: "OUT" }, { name: "파도튜브", race: "P", status: "OUT" }]},
  { date: "26.07.08", events: [{ name: "남덕선", race: "Z", status: "IN" }]}
];

function toISODate(d) {
  const m = String(d || "").match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  return m ? "20" + m[1] + "-" + m[2] + "-" + m[3] : null;
}

const rows = [];
let order = 0;
INOUT_HISTORY.forEach(function (day) {
  (day.events || []).forEach(function (ev) {
    rows.push({
      member_name: ev.name,
      event_type: ev.status,
      event_date: toISODate(day.date),
      race: ev.race,
      sort_order: order++
    });
  });
});

runImport({
  table: "inout_events",
  rows: rows,
  matchKey: function (r) { return r.member_name + "|" + r.event_date + "|" + r.event_type; },
  label: "inout_events"
}).catch(function (e) { console.error(e); process.exit(1); });
