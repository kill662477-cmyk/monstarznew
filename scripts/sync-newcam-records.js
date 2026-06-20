// 뉴캄옥션 참가자(36명) 전적 보강 동기화.
//
// 배경: 라이브(Supabase Storage)는 eloboard 증분 수집이 2026 체크포인트에서
// 멈춰 과거(예: 철구 2025) 전적이 빠져 있다. eloboard 현재 보드에는 최근 몇
// 경기만 남아 재스크랩으로는 과거를 복구할 수 없다. 반면 GitHub 의
// data/records/<key>.json 에는 과거 history 가 보존돼 있다.
//
// 이 스크립트는 재스크랩 없이:
//   data/records(history, trimmed) + Supabase(live, rich) 를 "합집합" 병합하고
//   - Supabase records/<key>.json.gz 는 rich 포맷으로 업로드
//   - data/records/<key>.json 은 기존 trimmed 포맷으로 갱신
// 데이터를 절대 삭제하지 않는다(중복은 live(rich) 우선).
//
// 사용: DRY_RUN=1 node scripts/sync-newcam-records.js  (검증, 쓰기 없음)
//       node scripts/sync-newcam-records.js            (실제 업로드/파일쓰기)
// 환경변수: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

const fs = require("fs");
const path = require("path");
const {
  uploadGzJson,
  downloadGzJson,
  ensureBucket,
  DEFAULT_BUCKET,
} = require("../lib/supabase/storage");

const DRY_RUN = process.env.DRY_RUN === "1";
const ROOT = path.resolve(__dirname, "..");
const RECORDS_DIR = path.join(ROOT, "data", "records");

// 뉴캄옥션 36명 (이름, 종족) — tierboard ENTRY_AUCTION_TEAMS 기준
const AUCTION = [
  ["기뉴다", "T"], ["지동원", "T"], ["지두두", "T"], ["졈니", "P"], ["2라니", "Z"], ["퀸주", "Z"],
  ["철구", "Z"], ["김윤환", "Z"], ["시조새", "P"], ["최세상", "T"], ["비타밍", "T"], ["갱이다", "T"],
  ["박성준", "Z"], ["흑운장", "T"], ["이유란", "Z"], ["구루미", "Z"], ["메옹", "T"], ["막내현진", "P"],
  ["이윤열", "T"], ["박재혁", "Z"], ["공다츠", "Z"], ["키링", "P"], ["임조이", "Z"], ["경콩", "T"],
  ["전태규", "P"], ["왜냐맨", "P"], ["박듀듀", "P"], ["치리", "Z"], ["박하악", "Z"], ["아리송이", "P"],
  ["김학수", "P"], ["이경민", "P"], ["토마토", "P"], ["오조은", "T"], ["정서린", "P"], ["먼진", "Z"],
];

function safeKey(v) {
  return String(v || "").replace(/[.#$/[\]]/g, "_");
}

function loadRosterPlayers() {
  const data = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "manual", "players.json"), "utf8")
  );
  const acc = [];
  (function walk(o) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      if (o.userId && o.name) acc.push(o);
      Object.values(o).forEach((v) => { if (v && typeof v === "object") walk(v); });
    }
  })(data);
  return acc;
}

function groupByDate(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const d = String(r.date || "");
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(r);
  });
  return map;
}

// trimmed(9필드) → rich(28필드) 변환. 누락 필드(elo/eloChange/matchType/memo)는 빈값.
function richFromTrimmed(row, player) {
  const winnerIsPlayer =
    (row.winnerSoopUserId && row.winnerSoopUserId === player.userId) ||
    (!row.winnerSoopUserId && row.winnerPlayer === player.name);
  return {
    id: row.id,
    date: row.date,
    standardDate: row.date,
    playedAt: row.date,
    playerName: player.name,
    playerRace: player.race,
    playerUserId: player.userId,
    opponentName: winnerIsPlayer ? row.losePlayer : row.winnerPlayer,
    opponentRace: winnerIsPlayer ? row.loseRace : row.winnerRace,
    map: row.map,
    elo: null,
    eloChange: null,
    matchType: "",
    memo: "",
    result: winnerIsPlayer ? "win" : "lose",
    isWin: Boolean(winnerIsPlayer),
    winnerPlayer: row.winnerPlayer,
    winnerName: row.winnerPlayer,
    winnerRace: row.winnerRace,
    losePlayer: row.losePlayer,
    loseName: row.losePlayer,
    loseRace: row.loseRace,
    winnerSoopUserId: row.winnerSoopUserId || "",
    winnerUserId: row.winnerSoopUserId || "",
    loseSoopUserId: row.loseSoopUserId || "",
    loserSoopUserId: row.loseSoopUserId || "",
    loseUserId: row.loseSoopUserId || "",
    loserUserId: row.loseSoopUserId || "",
  };
}

// rich → trimmed(9필드, data/records 기존 포맷)
function trimmedFromRich(row) {
  return {
    id: row.id,
    date: row.date,
    winnerRace: row.winnerRace,
    winnerSoopUserId: row.winnerSoopUserId || "",
    winnerPlayer: row.winnerPlayer,
    loseRace: row.loseRace,
    loseSoopUserId: row.loseSoopUserId || "",
    losePlayer: row.losePlayer,
    map: row.map,
  };
}

function yearDist(rows) {
  const y = {};
  rows.forEach((r) => {
    const d = String(r.date || "").slice(0, 4);
    y[d] = (y[d] || 0) + 1;
  });
  return y;
}

async function main() {
  const roster = loadRosterPlayers();
  if (!DRY_RUN) await ensureBucket(DEFAULT_BUCKET);

  let uploaded = 0;
  let skipped = 0;
  const missing = [];

  for (const [name, race] of AUCTION) {
    const cands = roster.filter((p) => p.name === name);
    const player = cands.find((c) => c.race === race) || cands[0];
    if (!player) { missing.push(`${name}(${race})`); continue; }

    const key = safeKey(`${player.userId}_${player.race}`);
    const file = path.join(RECORDS_DIR, `${key}.json`);

    let history = [];
    if (fs.existsSync(file)) {
      try { history = JSON.parse(fs.readFileSync(file, "utf8")) || []; } catch (e) { history = []; }
    }

    let live = [];
    try {
      const j = await downloadGzJson(DEFAULT_BUCKET, `records/${key}.json.gz`);
      live = Array.isArray(j) ? j : (j && j.rows) || [];
    } catch (e) { live = []; }

    // 날짜별로 더 완전한(행 많은) 쪽을 통째로 채택해 비손실 병합한다.
    // 같은 날 다전(여러 세트)을 합쳐버리지 않으면서, 한쪽에만 있는 날짜는 모두 보존한다.
    const histByDate = groupByDate(history);
    const liveByDate = groupByDate(live);
    const allDates = new Set([...histByDate.keys(), ...liveByDate.keys()]);
    const rows = [];
    allDates.forEach((d) => {
      const h = histByDate.get(d) || [];
      const l = liveByDate.get(d) || [];
      if (l.length >= h.length) rows.push(...l); // live(rich) 우선
      else rows.push(...h.map((r) => richFromTrimmed(r, player)));
    });
    rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    console.log(
      `${player.name}(${key}) history=${history.length} live=${live.length} -> merged=${rows.length} ${JSON.stringify(yearDist(rows))}`
    );

    if (DRY_RUN || !rows.length) { skipped += 1; continue; }

    await uploadGzJson(DEFAULT_BUCKET, `records/${key}.json.gz`, rows);
    fs.writeFileSync(file, JSON.stringify(rows.map(trimmedFromRich), null, 2));
    uploaded += 1;
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}완료 — 업로드 ${uploaded}, 건너뜀 ${skipped}, 매칭실패 ${missing.length}${missing.length ? " (" + missing.join(", ") + ")" : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
