const fs = require("fs/promises");
const path = require("path");
const admin = require("firebase-admin");
const { withAutomationLog } = require("./lib/automationLogger");
const {
  ensureBucket,
  uploadGzJson,
  downloadGzJson,
  DEFAULT_BUCKET,
} = require("../lib/supabase/storage");
const supabaseAdmin = require("../lib/supabase/admin");
const {
  buildHeadToHeadSummaries,
  summaryToDbRow,
} = require("../lib/tier-head-to-head-summary");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const recordDir = path.join(dataDir, "records");
const assetDir = path.join(root, "assets");
const profileDir = path.join(assetDir, "profile");
const academyDir = path.join(assetDir, "academy");

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app";

const FIREBASE_ROOT = process.env.FIREBASE_ROOT || "starcraftTier/current";

const MANUAL_PLAYERS_PATH = process.env.MANUAL_PLAYERS_PATH
  ? path.resolve(process.env.MANUAL_PLAYERS_PATH)
  : path.join(dataDir, "manual", "players.json");

const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.FETCH_TIMEOUT_MS || 15000));
const RECORD_CONCURRENCY = Math.max(1, Number(process.env.RECORD_CONCURRENCY || 3));
const RECORD_MAX_PAGES = Math.max(1, Number(process.env.RECORD_MAX_PAGES || 30));
const RECORD_FULL_MAX_PAGES = Math.max(
  1,
  Number(process.env.RECORD_FULL_MAX_PAGES || RECORD_MAX_PAGES)
);
const RECORD_INCREMENTAL_MAX_PAGES = Math.max(
  1,
  Number(process.env.RECORD_INCREMENTAL_MAX_PAGES || Math.min(RECORD_MAX_PAGES, 8))
);
const RECORD_AJAX_DELAY_MS = Math.max(0, Number(process.env.RECORD_AJAX_DELAY_MS || 150));
const RECORD_BACKFILL_VERSION = Math.max(1, Number(process.env.RECORD_BACKFILL_VERSION || 1));
const RECORD_SYNC_MODE = normalizeRecordSyncMode(process.env.RECORD_SYNC_MODE || "auto");
const ELOBOARD_MAX_ROWS_PER_PLAYER = Math.max(1, Number(process.env.ELOBOARD_MAX_ROWS_PER_PLAYER || 5000));
const INACTIVE_RECORD_MONTHS = Math.max(1, Number(process.env.INACTIVE_RECORD_MONTHS || 4));
const HIDE_INACTIVE_PLAYERS = process.env.HIDE_INACTIVE_PLAYERS !== "false";
const RECORD_META_SCHEMA_VERSION = 1;
const RECORD_META_RECENT_ID_LIMIT = Math.max(
  20,
  Number(process.env.RECORD_META_RECENT_ID_LIMIT || 120)
);

const CACHE_LOCAL_JSON = process.env.CACHE_LOCAL_JSON !== "false";
const CACHE_LOCAL_ASSETS = process.env.CACHE_LOCAL_ASSETS === "true";
const TIER_RECORD_STORAGE_UPLOAD =
  process.env.TIER_RECORD_STORAGE_UPLOAD === "true" ||
  process.env.UPLOAD_SUPABASE_RECORD_FILES === "true";
const TIER_RECORD_STORAGE_REQUIRED = process.env.TIER_RECORD_STORAGE_REQUIRED === "true";
const TIER_RECORD_STORAGE_BUCKET = process.env.TIER_RECORD_STORAGE_BUCKET || DEFAULT_BUCKET;
const TIER_RECORD_STORAGE_PREFIX = normalizeStoragePrefix(
  process.env.TIER_RECORD_STORAGE_PREFIX || "records"
);
const FIREBASE_RECORD_ROWS_UPLOAD =
  process.env.FIREBASE_RECORD_ROWS_UPLOAD !== "false" &&
  process.env.UPLOAD_FIREBASE_RECORD_ROWS !== "false";
const TIER_HEAD_TO_HEAD_SUMMARY_UPLOAD =
  process.env.TIER_HEAD_TO_HEAD_SUMMARY_UPLOAD === "true" ||
  process.env.TIER_H2H_SUMMARY_UPLOAD === "true";
const TIER_HEAD_TO_HEAD_SUMMARY_REQUIRED =
  process.env.TIER_HEAD_TO_HEAD_SUMMARY_REQUIRED === "true" ||
  process.env.TIER_H2H_SUMMARY_REQUIRED === "true";
const TIER_HEAD_TO_HEAD_SUMMARY_REBUILD_ALL =
  process.env.TIER_HEAD_TO_HEAD_SUMMARY_REBUILD_ALL !== "false";
const TIER_HEAD_TO_HEAD_SUMMARY_READ_CONCURRENCY = Math.max(
  1,
  Number(process.env.TIER_HEAD_TO_HEAD_SUMMARY_READ_CONCURRENCY || 8)
);

function normalizeStoragePrefix(value) {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function tierRecordStoragePath(key) {
  const fileName = `${safeKey(key)}.json.gz`;
  return TIER_RECORD_STORAGE_PREFIX ? `${TIER_RECORD_STORAGE_PREFIX}/${fileName}` : fileName;
}

const tierName = {
  G: "갓티어",
  K: "킹티어",
  J: "잭티어",
  O: "조커티어",
  S: "스페이드티어",
  B: "베이비티어",
  N: "티어없음",
};

const tierOrder = [
  "G",
  "K",
  "J",
  "O",
  "S",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "B",
  "N",
];

const headPeriods = ["ALL", "LAST_1_MONTHS", "LAST_2_MONTHS", "LAST_3_MONTHS"];

function normalizeRecordSyncMode(value) {
  const mode = String(value || "auto").trim().toLowerCase();

  if (mode === "full") return "full";
  if (mode === "incremental") return "incremental";
  return "auto";
}

function normalizeUrl(url) {
  if (!url) return "";
  const value = String(url);
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function safeKey(value) {
  return String(value || "").replace(/[.#$\/\[\]]/g, "_");
}

function localPath(file) {
  return file.split(path.sep).join("/");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eloboardUrl(key, race) {
  if (!key) return "";

  const matched = String(key)
    .split(",")
    .find((item) => item.split("_")[2] === race);

  if (!matched) return "";

  const [type, id] = matched.split("_");

  if (type === "W") {
    return `https://eloboard.com/women/bbs/board.php?bo_table=bj_list&wr_id=${id}`;
  }

  if (type === "M") {
    return `https://eloboard.com/women/bbs/board.php?bo_table=bj_m_list&wr_id=${id}`;
  }

  if (type === "P") {
    return `https://eloboard.com/men/bbs/board.php?bo_table=bj_list&wr_id=${id}`;
  }

  return "";
}

function eloboardRecordUrl(player) {
  return normalizeUrl(player.elo || eloboardUrl(player.eloboardKey, player.race));
}

function normalizeRace(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (raw === "T" || raw === "TERRAN" || raw === "테란") return "T";
  if (raw === "Z" || raw === "ZERG" || raw === "저그") return "Z";
  if (raw === "P" || raw === "PROTOSS" || raw === "토스" || raw === "프로토스") return "P";

  return raw || "";
}

function normalizeTierCode(value, fallbackTier) {
  const raw = String(value || "").trim();
  const tierText = String(fallbackTier || "").trim();

  if (tierOrder.includes(raw)) return raw;

  const map = {
    갓티어: "G",
    킹티어: "K",
    잭티어: "J",
    조커티어: "O",
    스페이드티어: "S",
    베이비티어: "B",
    티어없음: "N",
    없음: "N",
  };

  if (map[raw]) return map[raw];
  if (map[tierText]) return map[tierText];

  const numberMatch = raw.match(/^([0-8])(?:티어)?$/) || tierText.match(/^([0-8])(?:티어)?$/);
  if (numberMatch) return numberMatch[1];

  return "N";
}

function tierLabelFromCode(code, fallbackTier) {
  const tierCode = normalizeTierCode(code, fallbackTier);
  return tierName[tierCode] || `${tierCode}티어`;
}

function normalizeAcademy(item) {
  const academy = item.academy || item.academyInfo || item.school || item.team || null;

  if (!academy) return null;

  if (typeof academy === "string") {
    return {
      id: safeKey(academy),
      name: academy,
      image: "",
      sourceImage: "",
      position: item.academyPosition || item.position || "",
    };
  }

  const image = normalizeUrl(
    academy.image ||
      academy.logoImageUrl ||
      academy.logo ||
      academy.sourceImage ||
      academy.profileImageUrl ||
      ""
  );

  return {
    id: academy.id || safeKey(academy.name || item.academyName || "academy"),
    name: academy.name || item.academyName || "",
    image,
    sourceImage: normalizeUrl(academy.sourceImage || academy.logoImageUrl || image),
    position: academy.position || item.academyPosition || item.position || "",
  };
}

function normalizeManualPlayer(item, index) {
  const userId = String(
    item.userId || item.soopUserId || item.soopId || item.stationId || item.id || ""
  ).trim();

  const name = String(item.name || item.nickname || item.nick || item.playerName || userId).trim();
  const race = normalizeRace(item.race || item.raceCode || item.species);
  const tierCode = normalizeTierCode(item.tierCode || item.tierId || item.tier, item.tierName || item.tier);
  const profileImage = normalizeUrl(
    item.image || item.profileImage || item.profileImageUrl || item.sourceImage || item.logo || ""
  );
  const eloboardKey = String(item.eloboardKey || item.eloKey || item.eloBoardKey || "").trim();
  const station = item.station || item.stationUrl || (userId ? `https://www.sooplive.com/station/${userId}` : "");

  return {
    id: item.id || userId || `manual_${index + 1}`,
    userId,
    name,
    description: item.description || item.memo || "",
    race,
    tierCode,
    tier: tierLabelFromCode(tierCode, item.tier),
    tierId: item.tierId && String(item.tierId).startsWith("tier-") ? item.tierId : `tier-${tierCode}`,
    sortOrder: Number(item.sortOrder ?? item.order ?? item.rank ?? index + 1),

    eloboardKey,
    elo: item.elo || item.eloboardUrl || eloboardUrl(eloboardKey, race),

    image: CACHE_LOCAL_ASSETS ? localPath(path.join("assets", "profile", `${userId}.jpg`)) : profileImage,
    sourceImage: profileImage,

    station,
    stationStatus: Number(item.stationStatus || 0),

    academy: normalizeAcademy(item),

    monthWinRate: item.monthWinRate != null ? Number(item.monthWinRate) : null,
    yearWinRate: item.yearWinRate != null ? Number(item.yearWinRate) : null,
    winRate: item.winRate != null ? String(item.winRate) : "",

    live: false,
    broad: null,
    broadcastUrl: "",
  };
}

async function readManualPlayers() {
  const raw = await fs.readFile(MANUAL_PLAYERS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.players)
      ? parsed.players
      : Array.isArray(parsed.data)
        ? parsed.data
        : [];

  const players = list
    .map((item, index) => normalizeManualPlayer(item, index))
    .filter((player) => player.userId && player.name && player.race);

  if (players.length === 0) {
    throw new Error(`manual players empty or invalid: ${MANUAL_PLAYERS_PATH}`);
  }

  return players.sort((a, b) => {
    const aTierIndex = tierOrder.indexOf(a.tierCode);
    const bTierIndex = tierOrder.indexOf(b.tierCode);

    const tierDiff =
      (aTierIndex === -1 ? 999 : aTierIndex) -
      (bTierIndex === -1 ? 999 : bTierIndex);

    if (tierDiff !== 0) return tierDiff;

    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });
}

async function fetchBodyWithTimeout(url, options = {}, readBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const body = readBody ? await readBody(response) : null;

    return {
      response,
      body,
    };
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url) {
  const { response, body } = await fetchBodyWithTimeout(
    url,
    {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json,text/plain,*/*",
      },
    },
    (res) => res.text()
  );

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  if (!body) return null;

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`JSON parse failed: ${url}`);
  }
}

async function getText(url) {
  const { response, body } = await fetchBodyWithTimeout(
    url,
    {
      headers: {
        "user-agent": "Mozilla/5.0",
      },
    },
    (res) => res.text()
  );

  return {
    status: response.status,
    text: body || "",
  };
}

async function download(url, target) {
  const fullUrl = normalizeUrl(url);
  if (!fullUrl) return false;

  const { response, body } = await fetchBodyWithTimeout(
    fullUrl,
    {
      headers: {
        "user-agent": "Mozilla/5.0",
      },
    },
    (res) => res.arrayBuffer()
  );

  if (!response.ok || !body) return false;

  await fs.writeFile(target, Buffer.from(body));
  return true;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToTextLines(html) {
  const text = decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/td>/gi, " ")
      .replace(/<\/th>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );

  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseOpponentCell(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?)\s*\((T|Z|P|테란|저그|토스|프로토스)\)$/i);

  if (match) {
    return {
      opponentName: match[1].trim(),
      opponentRace: normalizeRace(match[2]),
    };
  }

  const compact = cleaned.match(/^(.+?)([TZP])$/i);

  if (compact) {
    return {
      opponentName: compact[1].trim(),
      opponentRace: normalizeRace(compact[2]),
    };
  }

  return {
    opponentName: cleaned,
    opponentRace: "",
  };
}

function makeEloboardRecord({ player, date, opponentName, opponentRace, map, eloChange, matchType, memo }) {
  const ownRace = normalizeRace(player.race);
  const numericEloChange = Number(eloChange);
  const isWin = numericEloChange > 0;

  const winnerPlayer = isWin ? player.name : opponentName;
  const winnerRace = isWin ? ownRace : opponentRace;
  const losePlayer = isWin ? opponentName : player.name;
  const loseRace = isWin ? opponentRace : ownRace;

  return {
    id: `${player.userId || player.name}_${date}_${opponentName}_${opponentRace}_${map}_${numericEloChange}_${matchType || ""}_${memo || ""}`
      .replace(/\s+/g, "_")
      .slice(0, 240),
    date,
    standardDate: date,
    playedAt: date,
    playerName: player.name,
    playerRace: ownRace,
    playerUserId: player.userId || "",
    opponentName,
    opponentRace,
    map,
    elo: numericEloChange,
    eloChange: numericEloChange,
    matchType: matchType || "",
    memo: memo || "",
    result: isWin ? "win" : "lose",
    isWin,

    winnerPlayer,
    winnerName: winnerPlayer,
    winnerRace,
    losePlayer,
    loseName: losePlayer,
    loseRace,

    winnerSoopUserId: isWin ? player.userId || "" : "",
    winnerUserId: isWin ? player.userId || "" : "",
    loseSoopUserId: isWin ? "" : player.userId || "",
    loserSoopUserId: isWin ? "" : player.userId || "",
    loseUserId: isWin ? "" : player.userId || "",
    loserUserId: isWin ? "" : player.userId || "",
  };
}

function parseEloboardRecordCells(cells, player) {
  const clean = cells
    .map((cell) => String(cell || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (clean.length < 5) return null;

  const dateMatch = clean[0].match(/\d{4}-\d{2}-\d{2}/);
  if (!dateMatch) return null;

  const eloIndex = clean.findIndex((cell, index) => index >= 3 && /^[+-]\d+(?:\.\d+)?$/.test(cell));
  if (eloIndex < 3) return null;

  const date = dateMatch[0];
  const { opponentName, opponentRace } = parseOpponentCell(clean[1]);
  const map = clean.slice(2, eloIndex).join(" ").trim();
  const numericEloChange = Number(clean[eloIndex]);
  const matchType = clean[eloIndex + 1] || "";
  const memo = clean.slice(eloIndex + 2).join(" ").trim();

  if (!opponentName || !opponentRace || !map || !Number.isFinite(numericEloChange)) return null;

  return makeEloboardRecord({
    player,
    date,
    opponentName,
    opponentRace,
    map,
    eloChange: numericEloChange,
    matchType,
    memo,
  });
}

function parseEloboardRowsByTable(html, player) {
  const records = [];
  const trRegex = /<tr\b[\s\S]*?<\/tr>/gi;
  const cellRegex = /<t[dh]\b[\s\S]*?<\/t[dh]>/gi;

  let trMatch;

  while ((trMatch = trRegex.exec(html))) {
    const rowHtml = trMatch[0];
    if (!/\d{4}-\d{2}-\d{2}/.test(rowHtml)) continue;

    const cells = [];
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowHtml))) {
      cells.push(stripTags(cellMatch[0]));
    }

    const record = parseEloboardRecordCells(cells, player);

    if (record) {
      records.push(record);
      if (records.length >= ELOBOARD_MAX_ROWS_PER_PLAYER) break;
    }
  }

  return records;
}

function parseEloboardRecordLine(line, player) {
  const compact = String(line || "").replace(/\s+/g, " ").trim();
  const match = compact.match(
    /^(\d{4}-\d{2}-\d{2})\s+(.+?)\s*\((T|Z|P|테란|저그|토스|프로토스)\)\s+(.+?)\s+([+-]\d+(?:\.\d+)?)\s+([0-9/()]+|단판)\s*(.*)$/
  );

  if (!match) return null;

  return makeEloboardRecord({
    player,
    date: match[1],
    opponentName: match[2].trim(),
    opponentRace: normalizeRace(match[3]),
    map: match[4].trim(),
    eloChange: Number(match[5]),
    matchType: match[6] || "",
    memo: match[7] || "",
  });
}

function parseEloboardRowsByText(html, player) {
  const lines = htmlToTextLines(html);
  const records = [];

  for (const line of lines) {
    if (!/^\d{4}-\d{2}-\d{2}\s+/.test(line)) continue;

    const row = parseEloboardRecordLine(line, player);

    if (row) {
      records.push(row);
      if (records.length >= ELOBOARD_MAX_ROWS_PER_PLAYER) break;
    }
  }

  return records;
}

function parseEloboardRecords(html, player) {
  const byTable = parseEloboardRowsByTable(html, player);
  if (byTable.length > 0) return byTable;

  return parseEloboardRowsByText(html, player);
}

function extractCookieHeader(response) {
  if (!response || !response.headers) return "";

  const cookies = [];

  if (typeof response.headers.getSetCookie === "function") {
    response.headers.getSetCookie().forEach((cookie) => {
      const first = String(cookie || "").split(";")[0].trim();
      if (first) cookies.push(first);
    });
  }

  const raw = response.headers.get("set-cookie");
  if (raw) {
    raw.split(/,(?=[^;,]+=)/).forEach((cookie) => {
      const first = String(cookie || "").split(";")[0].trim();
      if (first) cookies.push(first);
    });
  }

  return Array.from(new Set(cookies)).join("; ");
}

async function fetchEloboardPage(url) {
  const { response, body } = await fetchBodyWithTimeout(
    url,
    {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    },
    (res) => res.text()
  );

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return {
    html: body || "",
    cookieHeader: extractCookieHeader(response),
  };
}

async function fetchEloboardHtml(url) {
  const page = await fetchEloboardPage(url);
  return page.html;
}

function eloboardAjaxEndpoint(url) {
  const normalized = normalizeUrl(url);
  let section = normalized.includes("/men/") ? "men" : "women";

  try {
    const parsed = new URL(normalized);

    if (parsed.pathname.includes("/men/")) {
      section = "men";
    } else if (parsed.pathname.includes("/women/")) {
      section = "women";
    }
  } catch {
    // keep the fallback section parsed from the normalized string above
  }

  // ELOBOARD uses the same AJAX script for bj_list and bj_m_list.
  // Do not convert bo_table=bj_m_list into view_m_list.php; that endpoint returns 404.
  return `https://eloboard.com/${section}/bbs/view_list.php`;
}

async function fetchEloboardMoreHtml(url, player, lastId, cookieHeader = "") {
  const endpoint = eloboardAjaxEndpoint(url);

  const form = new URLSearchParams({
    p_name: player.name,
    last_id: String(lastId),
  });

  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    accept: "*/*",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
    origin: "https://eloboard.com",
    referer: url,
  };

  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }

  const { response, body } = await fetchBodyWithTimeout(
    endpoint,
    {
      method: "POST",
      headers,
      body: form.toString(),
    },
    (res) => res.text()
  );

  if (!response.ok) {
    throw new Error(`${response.status} ${endpoint}`);
  }

  return body || "";
}

function assertEloboardOk(html) {
  if (/max_user_connections|Too many connections|DB Connect Error/i.test(html)) {
    throw new Error("ELOBOARD connection limit page detected");
  }
}

function rowDate(row) {
  return String(
    row.date ||
      row.standardDate ||
      row.playedAt ||
      row.createdAt ||
      row.updatedAt ||
      row.matchDate ||
      ""
  ).slice(0, 10);
}

function normalizeRecordRows(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === "object");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .sort(([a], [b]) => {
        const na = Number(a);
        const nb = Number(b);

        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      })
      .map(([, row]) => row)
      .filter((row) => row && typeof row === "object");
  }

  return [];
}

function maxRecordDateString(rows) {
  let latest = "";

  normalizeRecordRows(rows).forEach((row) => {
    const date = rowDate(row);

    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > latest) {
      latest = date;
    }
  });

  return latest;
}

function dateMonthsAgo(now, months) {
  const value = new Date(now.getTime());
  value.setMonth(value.getMonth() - months);
  return value;
}

function isInactiveByLastRecordDate(lastRecordDate, now = new Date()) {
  if (!lastRecordDate) return true;

  const parsed = new Date(`${lastRecordDate}T00:00:00+09:00`);

  if (Number.isNaN(parsed.getTime())) return true;

  return parsed < dateMonthsAgo(now, INACTIVE_RECORD_MONTHS);
}

function sumRecordRows(records) {
  return Object.values(records || {}).reduce(
    (sum, rows) => sum + normalizeRecordRows(rows).length,
    0
  );
}
function isYouthTierPlayer(player) {
  const tierCode = normalizeTierCode(
    player.tierCode || player.tierId || player.tier,
    player.tierName || player.tier
  );

  const tierText = String(player.tier || player.tierName || "").trim();

  return (
    tierCode === "B" ||
    tierText === "베이비티어" ||
    tierText === "유스" ||
    tierText === "유스티어"
  );
}
function countRecordPlayers(records) {
  return Object.values(records || {}).filter(
    (rows) => normalizeRecordRows(rows).length > 0
  ).length;
}

function recordDedupKey(row, player) {
  if (!row || typeof row !== "object") return "";

  if (row.id) return String(row.id);

  const userId = player && player.userId ? player.userId : row.playerUserId || row.userId || "";
  const opponentName = row.opponentName || rowOpponentName(row, userId);
  const opponentRace = row.opponentRace || rowOpponentRace(row, userId);
  const map = row.map || row.mapName || "";
  const eloChange = row.eloChange ?? row.elo ?? "";
  const matchType = row.matchType || "";
  const memo = row.memo || "";

  return [
    userId,
    rowDate(row),
    opponentName,
    opponentRace,
    map,
    eloChange,
    matchType,
    memo,
  ]
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .join("|");
}

function sortRecordRows(rows) {
  return normalizeRecordRows(rows)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const dateDiff = rowDate(b.row).localeCompare(rowDate(a.row));
      if (dateDiff !== 0) return dateDiff;
      return a.index - b.index;
    })
    .map((item) => item.row);
}

function mergeRecordRows(newRows, existingRows, player) {
  const output = [];
  const seen = new Set();

  function add(row) {
    const key = recordDedupKey(row, player);
    if (!key || seen.has(key)) return;

    seen.add(key);
    output.push(row);
  }

  normalizeRecordRows(newRows).forEach(add);
  normalizeRecordRows(existingRows).forEach(add);

  return sortRecordRows(output).slice(0, ELOBOARD_MAX_ROWS_PER_PLAYER);
}

function makeRowCollector(player) {
  const rows = [];
  const seen = new Set();

  return {
    add(batch) {
      let added = 0;

      normalizeRecordRows(batch).forEach((row) => {
        const key = recordDedupKey(row, player);
        if (!key || seen.has(key)) return;

        seen.add(key);
        rows.push(row);
        added += 1;
      });

      return added;
    },
    rows() {
      return sortRecordRows(rows).slice(0, ELOBOARD_MAX_ROWS_PER_PLAYER);
    },
    size() {
      return seen.size;
    },
  };
}

async function fetchRecordsFull(player) {
  const url = eloboardRecordUrl(player);
  if (!url) return { rows: [], mode: "full", sourceRowCount: 0, morePagesFetched: 0 };

  const page = await fetchEloboardPage(url);
  assertEloboardOk(page.html);

  const collector = makeRowCollector(player);
  const firstRows = parseEloboardRecords(page.html, player);
  collector.add(firstRows);

  let morePagesFetched = 0;
  let duplicatePageCount = 0;

  for (let lastId = 1; lastId <= RECORD_FULL_MAX_PAGES; lastId += 1) {
    const moreHtml = await fetchEloboardMoreHtml(url, player, lastId, page.cookieHeader);
    assertEloboardOk(moreHtml);

    const rows = parseEloboardRecords(moreHtml, player);
    const added = collector.add(rows);
    morePagesFetched += 1;

    if (rows.length === 0) {
      break;
    }

    if (added === 0) {
      duplicatePageCount += 1;
    } else {
      duplicatePageCount = 0;
    }

    if (duplicatePageCount >= 2) {
      break;
    }

    if (collector.size() >= ELOBOARD_MAX_ROWS_PER_PLAYER) {
      break;
    }

    if (RECORD_AJAX_DELAY_MS > 0) {
      await sleep(RECORD_AJAX_DELAY_MS);
    }
  }

  const records = collector.rows();

  if (records.length === 0) {
    console.warn(`[records warn] ${player.name}(${player.userId}/${player.race}) full ELOBOARD parsed 0 rows`);
  }

  await sleep(250);

  return {
    rows: records,
    mode: "full",
    sourceRowCount: records.length,
    morePagesFetched,
  };
}

async function fetchRecordsIncremental(player, existingRows) {
  const url = eloboardRecordUrl(player);
  if (!url) {
    return {
      rows: normalizeRecordRows(existingRows),
      mode: "incremental",
      sourceRowCount: 0,
      newRowCount: 0,
      morePagesFetched: 0,
      stoppedByExisting: false,
    };
  }

  const existing = normalizeRecordRows(existingRows);
  if (existing.length === 0) {
    return fetchRecordsFull(player);
  }

  const existingKeys = new Set(existing.map((row) => recordDedupKey(row, player)).filter(Boolean));
  const newRows = [];
  const newSeen = new Set();

  function addOnlyNew(batch) {
    let added = 0;
    let foundExisting = false;

    normalizeRecordRows(batch).forEach((row) => {
      const key = recordDedupKey(row, player);
      if (!key) return;

      if (existingKeys.has(key)) {
        foundExisting = true;
        return;
      }

      if (newSeen.has(key)) return;

      newSeen.add(key);
      newRows.push(row);
      added += 1;
    });

    return {
      added,
      foundExisting,
    };
  }

  const page = await fetchEloboardPage(url);
  assertEloboardOk(page.html);

  const firstRows = parseEloboardRecords(page.html, player);
  const firstResult = addOnlyNew(firstRows);
  let stoppedByExisting = firstResult.foundExisting;
  let morePagesFetched = 0;

  if (!stoppedByExisting || firstRows.length === 0) {
    for (let lastId = 1; lastId <= RECORD_INCREMENTAL_MAX_PAGES; lastId += 1) {
      const moreHtml = await fetchEloboardMoreHtml(url, player, lastId, page.cookieHeader);
      assertEloboardOk(moreHtml);

      const rows = parseEloboardRecords(moreHtml, player);
      const result = addOnlyNew(rows);
      morePagesFetched += 1;

      if (result.foundExisting) {
        stoppedByExisting = true;
        break;
      }

      if (rows.length === 0) {
        break;
      }

      if (RECORD_AJAX_DELAY_MS > 0) {
        await sleep(RECORD_AJAX_DELAY_MS);
      }
    }
  }

  const merged = mergeRecordRows(newRows, existing, player);

  await sleep(250);

  return {
    rows: merged,
    mode: "incremental",
    sourceRowCount: newRows.length,
    newRowCount: newRows.length,
    morePagesFetched,
    stoppedByExisting,
  };
}

async function fetchRecordsSmart(player, existingRows, effectiveMode) {
  if (effectiveMode === "incremental") {
    return fetchRecordsIncremental(player, existingRows);
  }

  return fetchRecordsFull(player);
}

async function readExistingRecordRows(rootRef, key) {
  const snap = await withRetry(`records/${key} existing read`, () =>
    rootRef.child("records").child(key).once("value")
  );

  return normalizeRecordRows(snap.val());
}


function normalizeRecentRecordIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "")).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.values(value).map((item) => String(item || "")).filter(Boolean);
  }

  return [];
}

function normalizeRecordMetaEntry(value) {
  const entry = value && typeof value === "object" ? value : {};
  const recordCount = Math.max(0, Number(entry.recordCount || 0));
  const nextRowIndex = Math.max(recordCount, Number(entry.nextRowIndex || recordCount));

  return {
    schemaVersion: Number(entry.schemaVersion || 0),
    recordCount,
    nextRowIndex,
    lastRecordDate: String(entry.lastRecordDate || ""),
    recentRecordIds: normalizeRecentRecordIds(entry.recentRecordIds).slice(
      0,
      RECORD_META_RECENT_ID_LIMIT
    ),
    updatedAt: entry.updatedAt || null,
    bootstrappedAt: entry.bootstrappedAt || null,
  };
}

function recentRecordIdsFromRows(rows, player) {
  const ids = [];
  const seen = new Set();

  sortRecordRows(rows).forEach((row) => {
    const id = recordDedupKey(row, player);
    if (!id || seen.has(id) || ids.length >= RECORD_META_RECENT_ID_LIMIT) return;
    seen.add(id);
    ids.push(id);
  });

  return ids;
}

function mergeRecentRecordIds(newRows, player, existingIds) {
  const ids = [];
  const seen = new Set();

  function add(id) {
    const value = String(id || "");
    if (!value || seen.has(value) || ids.length >= RECORD_META_RECENT_ID_LIMIT) return;
    seen.add(value);
    ids.push(value);
  }

  sortRecordRows(newRows).forEach((row) => add(recordDedupKey(row, player)));
  normalizeRecentRecordIds(existingIds).forEach(add);

  return ids;
}

function maxNumericChildIndex(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;

  let max = -1;

  Object.keys(value).forEach((key) => {
    if (!/^\d+$/.test(String(key))) return;
    max = Math.max(max, Number(key));
  });

  return max + 1;
}

function buildRecordMetaEntry(rows, player, options = {}) {
  const list = normalizeRecordRows(rows);
  const nowIso = options.updatedAt || new Date().toISOString();
  const recordCount = Math.max(0, Number(options.recordCount ?? list.length));
  const nextRowIndex = Math.max(
    recordCount,
    Number(options.nextRowIndex ?? recordCount)
  );

  return {
    schemaVersion: RECORD_META_SCHEMA_VERSION,
    recordCount,
    nextRowIndex,
    lastRecordDate: options.lastRecordDate || maxRecordDateString(list),
    recentRecordIds:
      options.recentRecordIds || recentRecordIdsFromRows(list, player),
    updatedAt: nowIso,
    bootstrappedAt: options.bootstrappedAt || nowIso,
  };
}

function advanceRecordMetaEntry(existingMeta, newRows, player) {
  const previous = normalizeRecordMetaEntry(existingMeta);
  const list = normalizeRecordRows(newRows);
  const latestNewDate = maxRecordDateString(list);
  const nowIso = new Date().toISOString();

  return {
    schemaVersion: RECORD_META_SCHEMA_VERSION,
    recordCount: previous.recordCount + list.length,
    nextRowIndex: previous.nextRowIndex + list.length,
    lastRecordDate:
      latestNewDate && latestNewDate > previous.lastRecordDate
        ? latestNewDate
        : previous.lastRecordDate,
    recentRecordIds: mergeRecentRecordIds(list, player, previous.recentRecordIds),
    updatedAt: nowIso,
    bootstrappedAt: previous.bootstrappedAt || nowIso,
  };
}

async function readExistingRecordMeta(rootRef) {
  const snap = await withRetry("recordMeta read", () =>
    rootRef.child("recordMeta").once("value")
  );

  const value = snap.val() || {};
  const output = {};

  Object.entries(value).forEach(([key, entry]) => {
    output[key] = normalizeRecordMetaEntry(entry);
  });

  return output;
}

async function readExistingRecordState(rootRef, key) {
  const snap = await withRetry(`records/${key} bootstrap read`, () =>
    rootRef.child("records").child(key).once("value")
  );
  const value = snap.val();

  return {
    value,
    rows: normalizeRecordRows(value),
    nextRowIndex: maxNumericChildIndex(value),
    source: "firebase",
  };
}

async function readExistingRecordStatePreferStorage(rootRef, key) {
  if (TIER_RECORD_STORAGE_UPLOAD) {
    try {
      const value = await downloadGzJson(
        TIER_RECORD_STORAGE_BUCKET,
        tierRecordStoragePath(key)
      );
      const rows = normalizeRecordRows(value);

      if (value !== null && value !== undefined) {
        return {
          value,
          rows,
          nextRowIndex: rows.length,
          source: "supabase-storage",
        };
      }
    } catch (error) {
      console.warn(
        `[storage] records/${key} read failed; fallback to Firebase: ${error.message}`
      );
    }
  }

  return readExistingRecordState(rootRef, key);
}

async function fetchRecordsIncrementalByCheckpoint(player, recordMeta) {
  const url = eloboardRecordUrl(player);
  const checkpoint = new Set(normalizeRecentRecordIds(recordMeta.recentRecordIds));

  if (!url) {
    return {
      rows: [],
      mode: "incremental-checkpoint",
      newRowCount: 0,
      sourceRowCount: 0,
      morePagesFetched: 0,
      stoppedByExisting: false,
      checkpointMissing: checkpoint.size === 0,
      checkpointMiss: false,
    };
  }

  if (checkpoint.size === 0) {
    return {
      rows: [],
      mode: "incremental-checkpoint",
      newRowCount: 0,
      sourceRowCount: 0,
      morePagesFetched: 0,
      stoppedByExisting: false,
      checkpointMissing: true,
      checkpointMiss: false,
    };
  }

  const newRows = [];
  const newSeen = new Set();

  function addOnlyNew(batch) {
    let foundExisting = false;

    normalizeRecordRows(batch).forEach((row) => {
      const key = recordDedupKey(row, player);
      if (!key) return;

      if (checkpoint.has(key)) {
        foundExisting = true;
        return;
      }

      if (newSeen.has(key)) return;
      newSeen.add(key);
      newRows.push(row);
    });

    return foundExisting;
  }

  const page = await fetchEloboardPage(url);
  assertEloboardOk(page.html);

  const firstRows = parseEloboardRecords(page.html, player);
  let stoppedByExisting = addOnlyNew(firstRows);
  let morePagesFetched = 0;
  let exhaustedSource = firstRows.length === 0;

  if (!stoppedByExisting && !exhaustedSource) {
    for (let lastId = 1; lastId <= RECORD_INCREMENTAL_MAX_PAGES; lastId += 1) {
      const moreHtml = await fetchEloboardMoreHtml(url, player, lastId, page.cookieHeader);
      assertEloboardOk(moreHtml);

      const rows = parseEloboardRecords(moreHtml, player);
      morePagesFetched += 1;

      if (addOnlyNew(rows)) {
        stoppedByExisting = true;
        break;
      }

      if (rows.length === 0) {
        exhaustedSource = true;
        break;
      }

      if (RECORD_AJAX_DELAY_MS > 0) {
        await sleep(RECORD_AJAX_DELAY_MS);
      }
    }
  }

  await sleep(250);

  return {
    rows: sortRecordRows(newRows),
    mode: "incremental-checkpoint",
    newRowCount: newRows.length,
    sourceRowCount: newRows.length,
    morePagesFetched,
    stoppedByExisting,
    checkpointMissing: false,
    checkpointMiss: !stoppedByExisting && !exhaustedSource,
  };
}

function rowWinnerId(row) {
  return String(
    row.winnerSoopUserId ||
      row.winnerUserId ||
      row.winnerId ||
      row.winner ||
      row.winSoopUserId ||
      row.winUserId ||
      ""
  );
}

function rowLoserId(row) {
  return String(
    row.loseSoopUserId ||
      row.loserSoopUserId ||
      row.loseUserId ||
      row.loserUserId ||
      row.loserId ||
      row.loseId ||
      row.loser ||
      ""
  );
}

function rowWinnerName(row) {
  return String(row.winnerPlayer || row.winnerName || row.winPlayer || row.winName || "");
}

function rowLoserName(row) {
  return String(row.losePlayer || row.loserPlayer || row.loseName || row.loserName || "");
}

function rowWinnerRace(row) {
  return String(row.winnerRace || row.winRace || "");
}

function rowLoserRace(row) {
  return String(row.loseRace || row.loserRace || "");
}

function rowOpponentName(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId && winnerId === String(userId)) {
    return rowLoserName(row) || row.opponentName || "";
  }

  if (loserId && loserId === String(userId)) {
    return rowWinnerName(row) || row.opponentName || "";
  }

  return row.opponentName || "";
}

function rowOpponentRace(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId && winnerId === String(userId)) {
    return rowLoserRace(row) || row.opponentRace || "";
  }

  if (loserId && loserId === String(userId)) {
    return rowWinnerRace(row) || row.opponentRace || "";
  }

  return row.opponentRace || "";
}

function rowOpponentId(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId && winnerId === String(userId)) return loserId;
  if (loserId && loserId === String(userId)) return winnerId;

  return String(row.opponentSoopUserId || row.opponentUserId || "");
}

function rowIsWin(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId) {
    return winnerId === String(userId);
  }

  if (loserId) {
    return loserId !== String(userId);
  }

  const result = String(row.result || row.win || row.status || "").toLowerCase();

  return result === "win" || result === "w" || row.isWin === true;
}

function parseDateMonth(value) {
  const text = String(value || "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})/.exec(text);

  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

function periodIncludes(dateValue, period, now = new Date()) {
  if (period === "ALL") return true;

  const match = /^LAST_(\d+)_MONTHS$/.exec(period);
  if (!match) return true;

  const limit = Number(match[1]);
  const parsed = parseDateMonth(dateValue);

  if (!parsed) return false;

  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const diff = (nowYear - parsed.year) * 12 + (nowMonth - parsed.month);

  return diff >= 0 && diff < limit;
}

function headToHeadKey(player, opponent, period) {
  return safeKey(
    [player.userId, player.race, opponent.userId, opponent.race, period].join("_")
  );
}

function buildHeadToHead(players, records) {
  const headToHead = {};
  const byUserRace = new Map();
  const byUserOnly = new Map();
  const byNameRace = new Map();

  players.forEach((player) => {
    byUserRace.set(`${player.userId}_${player.race}`, player);
    byUserOnly.set(String(player.userId), player);

    const nameRaceKey = `${player.name}_${player.race}`;
    if (!byNameRace.has(nameRaceKey)) {
      byNameRace.set(nameRaceKey, []);
    }

    byNameRace.get(nameRaceKey).push(player);
  });

  function findOpponent(row, player) {
    const opponentId = rowOpponentId(row, player.userId);
    const opponentRace = rowOpponentRace(row, player.userId);
    const opponentName = rowOpponentName(row, player.userId);

    if (opponentId && opponentRace) {
      const exact = byUserRace.get(`${opponentId}_${opponentRace}`);
      if (exact) return exact;

      return {
        userId: opponentId,
        race: opponentRace,
        name: opponentName || opponentId,
      };
    }

    if (opponentId) {
      const byUser = byUserOnly.get(opponentId);
      if (byUser) return byUser;
    }

    if (opponentName && opponentRace) {
      const candidates = byNameRace.get(`${opponentName}_${opponentRace}`) || [];
      if (candidates.length === 1) return candidates[0];
    }

    return null;
  }

  function addScore(player, opponent, period, isWin) {
    const key = headToHeadKey(player, opponent, period);

    if (!headToHead[key]) {
      headToHead[key] = {
        player1UserId: player.userId,
        player1Name: player.name,
        player1Race: player.race,
        player2UserId: opponent.userId,
        player2Name: opponent.name || "",
        player2Race: opponent.race,
        period,
        player1Wins: 0,
        player2Wins: 0,
        totalCount: 0,
      };
    }

    if (isWin) {
      headToHead[key].player1Wins += 1;
    } else {
      headToHead[key].player2Wins += 1;
    }

    headToHead[key].totalCount += 1;
  }

  players.forEach((player) => {
    const recordKey = safeKey(`${player.userId}_${player.race}`);
    const rows = Array.isArray(records[recordKey]) ? records[recordKey] : [];

    rows.forEach((row) => {
      const opponent = findOpponent(row, player);
      if (!opponent || !opponent.userId || !opponent.race) return;

      const date = rowDate(row);
      const isWin = rowIsWin(row, player.userId);

      headPeriods.forEach((period) => {
        if (!periodIncludes(date, period)) return;
        addScore(player, opponent, period, isWin);
      });
    });
  });

  return headToHead;
}

function buildWinRates(players) {
  const winRates = {};

  players.forEach((player) => {
    winRates[safeKey(player.userId)] = {
      userId: player.userId,
      name: player.name,
      race: player.race,
      monthWinRate: player.monthWinRate,
      yearWinRate: player.yearWinRate,
      winRate: player.winRate,
    };
  });

  return winRates;
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (value && typeof value === "object") {
    const output = {};

    Object.entries(value).forEach(([key, item]) => {
      if (item === undefined) return;
      output[key] = removeUndefined(item);
    });

    return output;
  }

  return value;
}

function firebaseCredential() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (rawJson) {
    const parsed = JSON.parse(rawJson);

    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }

    return admin.credential.cert(parsed);
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  }

  return admin.credential.applicationDefault();
}

function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: firebaseCredential(),
      databaseURL: FIREBASE_DATABASE_URL,
    });
  }

  return admin.database();
}

async function closeFirebase() {
  await Promise.all(
    admin.apps.map((app) =>
      app.delete().catch((error) => {
        console.warn("[firebase] close failed:", error.message);
      })
    )
  );
}

function isWriteTooBigError(error) {
  const text = `${error && error.code ? error.code : ""} ${
    error && error.message ? error.message : error
  }`;

  return /WRITE_TOO_BIG|write_too_big/i.test(text);
}

function isTransientFirebaseError(error) {
  const text = `${error && error.code ? error.code : ""} ${
    error && error.message ? error.message : error
  }`;

  return /operation was canceled|cancelled|canceled|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|network/i.test(
    text
  );
}

async function withRetry(label, worker, maxAttempts = 8) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await worker();
    } catch (error) {
      lastError = error;

      if (isWriteTooBigError(error) || !isTransientFirebaseError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const waitMs = 1000 * attempt;

      console.warn(
        `[firebase] ${label} failed (${error.message}). retry ${attempt}/${
          maxAttempts - 1
        } after ${waitMs}ms`
      );

      await sleep(waitMs);
    }
  }

  throw lastError;
}

async function readExistingMeta(rootRef) {
  const snap = await withRetry("meta read", () => rootRef.child("meta").once("value"));
  return snap.val() || {};
}

function resolveEffectiveRecordSyncMode(existingMeta) {
  if (RECORD_SYNC_MODE === "full") return "full";
  if (RECORD_SYNC_MODE === "incremental") return "incremental";

  const existingBackfillVersion = Number(existingMeta.recordsBackfillVersion || 0);

  if (existingBackfillVersion >= RECORD_BACKFILL_VERSION) {
    return "incremental";
  }

  return "full";
}

async function clearChildrenInChunks(ref, chunkSize, label) {
  let cleared = 0;

  while (true) {
    const snap = await withRetry(`${label} read children for clear`, () =>
      ref.orderByKey().limitToFirst(chunkSize).once("value")
    );

    if (!snap.exists()) {
      break;
    }

    const updates = {};

    snap.forEach((child) => {
      if (child.key != null) {
        updates[child.key] = null;
      }
    });

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      break;
    }

    await withRetry(`${label} clear batch`, () => ref.update(updates));

    cleared += keys.length;
    console.log(`[firebase] ${label} cleared ${cleared}`);
  }
}

async function uploadObjectInChunks(ref, object, chunkSize, label) {
  const entries = Object.entries(object || {});
  const total = entries.length;

  console.log(`[firebase] clear ${label} in child chunks`);
  await clearChildrenInChunks(ref, Math.max(1, chunkSize), label);

  if (total === 0) {
    console.log(`[firebase] ${label} empty`);
    return;
  }

  for (let i = 0; i < total; i += chunkSize) {
    const batch = {};

    entries.slice(i, i + chunkSize).forEach(([key, value]) => {
      batch[key] = value;
    });

    await withRetry(`${label} upload ${i + 1}-${Math.min(i + chunkSize, total)}`, () =>
      ref.update(batch)
    );

    console.log(`[firebase] ${label} uploaded ${Math.min(i + chunkSize, total)}/${total}`);
  }
}

async function uploadArrayRowsInChunks(ref, rows, chunkSize, label) {
  const list = Array.isArray(rows) ? rows : [];

  console.log(`[firebase] clear ${label} rows`);
  await clearChildrenInChunks(ref, Math.max(1, chunkSize), label);

  if (list.length === 0) {
    console.log(`[firebase] ${label} empty`);
    return;
  }

  for (let i = 0; i < list.length; i += chunkSize) {
    const batch = {};

    list.slice(i, i + chunkSize).forEach((row, offset) => {
      batch[String(i + offset)] = row;
    });

    await withRetry(`${label} rows upload ${i + 1}-${Math.min(i + chunkSize, list.length)}`, () =>
      ref.update(batch)
    );

    console.log(`[firebase] ${label} rows uploaded ${Math.min(i + chunkSize, list.length)}/${list.length}`);
  }
}

async function uploadPlayerRecordsSmart(ref, key, rows, rowChunkSize, label) {
  const list = Array.isArray(rows) ? rows : [];
  const playerRef = ref.child(key);

  try {
    await withRetry(`${label}/${key} set`, () => playerRef.set(list));
    console.log(`[firebase] ${label}/${key} set uploaded ${list.length}`);
    return;
  } catch (error) {
    if (!isWriteTooBigError(error)) {
      throw error;
    }

    console.warn(`[firebase] ${label}/${key} set too big. fallback to row chunks: ${error.message}`);
  }

  await uploadArrayRowsInChunks(playerRef, list, rowChunkSize, `${label}/${key}`);
}

async function uploadRecordsInChunks(ref, records, rowChunkSize, label) {
  const entries = Object.entries(records || {});
  const total = entries.length;

  if (total === 0) {
    console.log(`[firebase] ${label} empty`);
    return;
  }

  for (let i = 0; i < total; i += 1) {
    const [key, rows] = entries[i];

    await uploadPlayerRecordsSmart(ref, key, rows, rowChunkSize, label);

    console.log(`[firebase] ${label} players uploaded ${i + 1}/${total}`);
  }
}

function queueRecordStorageUpload(recordStorageUploads, key, rows) {
  if (!TIER_RECORD_STORAGE_UPLOAD || !key) return;
  recordStorageUploads[key] = normalizeRecordRows(rows);
}

async function uploadRecordStorageFiles(recordStorageUploads) {
  const stats = {
    enabled: TIER_RECORD_STORAGE_UPLOAD,
    bucket: TIER_RECORD_STORAGE_BUCKET,
    prefix: TIER_RECORD_STORAGE_PREFIX,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    totalGzipBytes: 0,
  };

  if (!TIER_RECORD_STORAGE_UPLOAD) {
    console.log("[storage] tier record gzip upload disabled");
    return stats;
  }

  const entries = Object.entries(recordStorageUploads || {});
  stats.attempted = entries.length;

  if (entries.length === 0) {
    console.log("[storage] tier record gzip upload empty");
    return stats;
  }

  try {
    await ensureBucket(TIER_RECORD_STORAGE_BUCKET);
  } catch (error) {
    stats.failed = entries.length;
    console.warn(`[storage] bucket prepare failed: ${error.message}`);
    if (TIER_RECORD_STORAGE_REQUIRED) throw error;
    return stats;
  }

  for (let i = 0; i < entries.length; i += 1) {
    const [key, rows] = entries[i];

    try {
      const result = await uploadGzJson(
        TIER_RECORD_STORAGE_BUCKET,
        tierRecordStoragePath(key),
        normalizeRecordRows(rows)
      );
      stats.succeeded += 1;
      stats.totalGzipBytes += Number(result.size || 0);
      console.log(`[storage] records/${key}.json.gz uploaded ${i + 1}/${entries.length}`);
    } catch (error) {
      stats.failed += 1;
      console.warn(`[storage] records/${key}.json.gz upload failed: ${error.message}`);
      if (TIER_RECORD_STORAGE_REQUIRED) throw error;
    }
  }

  return stats;
}

async function upsertHeadToHeadSummaryRows(rows) {
  const chunkSize = Math.max(1, Number(process.env.TIER_HEAD_TO_HEAD_SUMMARY_CHUNK_SIZE || 500));
  let succeeded = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await supabaseAdmin.rest("POST", "tier_head_to_head_summaries", {
      query: "?on_conflict=pair_key",
      body: chunk,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    succeeded += chunk.length;
    console.log(
      `[supabase] h2h summaries upserted ${Math.min(i + chunk.length, rows.length)}/${rows.length}`
    );
  }

  return succeeded;
}

async function collectHeadToHeadRecordInputs(players, recordStorageUploads, stats) {
  const recordsByKey = { ...(recordStorageUploads || {}) };

  if (!TIER_HEAD_TO_HEAD_SUMMARY_REBUILD_ALL) return recordsByKey;

  await mapLimit(players, TIER_HEAD_TO_HEAD_SUMMARY_READ_CONCURRENCY, async (player, index) => {
    const key = safeKey(`${player.userId}_${player.race}`);
    if (!key || recordsByKey[key]) return;

    try {
      const value = await downloadGzJson(
        TIER_RECORD_STORAGE_BUCKET,
        tierRecordStoragePath(key)
      );
      const rows = normalizeRecordRows(value);
      if (rows.length) {
        recordsByKey[key] = rows;
        stats.storageReadSucceeded += 1;
      } else {
        stats.storageReadEmpty += 1;
      }
    } catch (error) {
      stats.storageReadFailed += 1;
      console.warn(`[supabase] h2h records/${key} read failed: ${error.message}`);
      if (TIER_HEAD_TO_HEAD_SUMMARY_REQUIRED) throw error;
    }

    if ((index + 1) % 50 === 0 || index + 1 === players.length) {
      console.log(`[supabase] h2h source records prepared ${index + 1}/${players.length}`);
    }
  });

  return recordsByKey;
}

async function uploadHeadToHeadSummaries(players, recordStorageUploads) {
  const stats = {
    enabled: TIER_HEAD_TO_HEAD_SUMMARY_UPLOAD,
    rebuildAll: TIER_HEAD_TO_HEAD_SUMMARY_REBUILD_ALL,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    storageReadSucceeded: 0,
    storageReadEmpty: 0,
    storageReadFailed: 0,
  };

  if (!TIER_HEAD_TO_HEAD_SUMMARY_UPLOAD) {
    console.log("[supabase] h2h summary upload disabled");
    return stats;
  }

  try {
    const recordsByKey = await collectHeadToHeadRecordInputs(
      players,
      recordStorageUploads,
      stats
    );
    const summaries = buildHeadToHeadSummaries(players, recordsByKey);
    const updatedAt = new Date().toISOString();
    const rows = summaries.map((summary) => ({
      ...summaryToDbRow(summary, updatedAt),
      source: "collect-data",
    }));
    stats.attempted = rows.length;

    if (!rows.length) {
      console.log("[supabase] h2h summaries empty");
      return stats;
    }

    stats.succeeded = await upsertHeadToHeadSummaryRows(rows);
    return stats;
  } catch (error) {
    stats.failed = Math.max(stats.attempted, 1);
    console.warn(`[supabase] h2h summary upload failed: ${error.message}`);
    if (TIER_HEAD_TO_HEAD_SUMMARY_REQUIRED) throw error;
    return stats;
  }
}

async function readExistingLiveState(rootRef) {
  console.log("[firebase] read existing liveStatus");

  const snap = await withRetry("liveStatus read", () =>
    rootRef.child("liveStatus").once("value")
  );

  const liveStatus = snap.val() || {};

  const liveCount = Object.values(liveStatus).filter(
    (item) => item && item.live === true
  ).length;

  return {
    liveStatus,
    liveCount,
  };
}

async function uploadRecordAppends(rootRef, recordAppends, recordMeta) {
  const entries = Object.entries(recordAppends || {});

  for (let i = 0; i < entries.length; i += 1) {
    const [key, item] = entries[i];
    const rows = normalizeRecordRows(item.rows);
    const startIndex = Math.max(0, Number(item.startIndex || 0));
    const updates = {};

    rows.forEach((row, offset) => {
      updates[`records/${key}/${startIndex + offset}`] = row;
    });

    if (recordMeta && recordMeta[key]) {
      updates[`recordMeta/${key}`] = recordMeta[key];
    }

    if (Object.keys(updates).length > 0) {
      await withRetry(`records/${key} append ${rows.length}`, () => rootRef.update(updates));
    }

    console.log(`[firebase] records/${key} appended ${rows.length} (${i + 1}/${entries.length})`);
  }
}

async function uploadToFirebase(payload) {
  const db = initFirebase();
  const cleanPayload = removeUndefined(payload);
  const rootRef = db.ref(FIREBASE_ROOT);

  const { liveCount: existingLiveCount } = await readExistingLiveState(rootRef);

  const metaWithPreservedLive = {
    ...(cleanPayload.meta || {}),
    liveCount: existingLiveCount,
    liveSource: "preserved-from-soop-sync",
  };

  console.log("[firebase] upload meta");
  await rootRef.child("meta").set(metaWithPreservedLive);

  console.log("[firebase] upload players");
  await rootRef.child("players").set(cleanPayload.players || []);

  console.log("[firebase] upload winRates");
  await rootRef.child("winRates").set(cleanPayload.winRates || {});

  if (FIREBASE_RECORD_ROWS_UPLOAD) {
    console.log("[firebase] upload record replacements only");
    await uploadRecordsInChunks(
      rootRef.child("records"),
      cleanPayload.recordReplacements || {},
      100,
      "records-replace"
    );

    console.log("[firebase] append newly discovered records only");
    await uploadRecordAppends(
      rootRef,
      cleanPayload.recordAppends || {},
      cleanPayload.recordMeta || {}
    );
  } else {
    console.log("[firebase] skip bulky records rows upload; compact recordMeta only");
  }

  console.log("[firebase] upload compact recordMeta");
  await rootRef.child("recordMeta").set(cleanPayload.recordMeta || {});

  // headToHead is intentionally not rebuilt or uploaded here.
  // The frontend computes opponent stats from the selected player's loaded records.

  console.log("[firebase] upload public meta");
  await db.ref("starcraftTier/meta").set({
    lastSyncedAt: metaWithPreservedLive.syncedAt,
    currentRoot: FIREBASE_ROOT,
    playerCount: metaWithPreservedLive.playerCount,
    sourcePlayerCount: metaWithPreservedLive.sourcePlayerCount,
    hiddenInactivePlayerCount: metaWithPreservedLive.hiddenInactivePlayerCount,
    liveCount: existingLiveCount,
    recordPlayerCount: metaWithPreservedLive.recordPlayerCount,
    recordRowCount: metaWithPreservedLive.recordRowCount,
    recordFailCount: metaWithPreservedLive.recordFailCount,
    recordSkipCount: metaWithPreservedLive.recordSkipCount,
    recordsBackfillVersion: metaWithPreservedLive.recordsBackfillVersion,
    recordsBackfillComplete: metaWithPreservedLive.recordsBackfillComplete,
    recordsBackfilledAt: metaWithPreservedLive.recordsBackfilledAt,
    recordsBackfillCompletedWithFailures: metaWithPreservedLive.recordsBackfillCompletedWithFailures,
    recordSyncMode: metaWithPreservedLive.recordSyncMode,
    effectiveRecordSyncMode: metaWithPreservedLive.effectiveRecordSyncMode,
    recordMetaSchemaVersion: metaWithPreservedLive.recordMetaSchemaVersion,
    recordMetaBootstrapCount: metaWithPreservedLive.recordMetaBootstrapCount,
    recordAppendRowCount: metaWithPreservedLive.recordAppendRowCount,
    headToHeadMode: metaWithPreservedLive.headToHeadMode,
    sourceLastUpdatedAt: metaWithPreservedLive.sourceLastUpdatedAt,
  });

  console.log("[firebase] upload complete");

  return metaWithPreservedLive;
}

async function main(run = {}) {
  await Promise.all(
    [dataDir, recordDir, assetDir, profileDir, academyDir].map((dir) =>
      fs.mkdir(dir, { recursive: true })
    )
  );

  console.log("[config]", {
    FIREBASE_ROOT,
    MANUAL_PLAYERS_PATH,
    FETCH_TIMEOUT_MS,
    RECORD_CONCURRENCY,
    RECORD_MAX_PAGES,
    RECORD_FULL_MAX_PAGES,
    RECORD_INCREMENTAL_MAX_PAGES,
    RECORD_AJAX_DELAY_MS,
    RECORD_SYNC_MODE,
    RECORD_BACKFILL_VERSION,
    ELOBOARD_MAX_ROWS_PER_PLAYER,
    INACTIVE_RECORD_MONTHS,
    HIDE_INACTIVE_PLAYERS,
    RECORD_META_SCHEMA_VERSION,
    RECORD_META_RECENT_ID_LIMIT,
    CACHE_LOCAL_JSON,
    CACHE_LOCAL_ASSETS,
    TIER_HEAD_TO_HEAD_SUMMARY_UPLOAD,
    TIER_HEAD_TO_HEAD_SUMMARY_REQUIRED,
  });

  console.log("[1/6] 수동 플레이어 데이터 로드 시작");

  const [manualPlayers, lastUpdated] = await Promise.all([
    readManualPlayers(),
    getJson("https://www.cnine.kr/api/v2/p/starcraft/eloboard/last-updated-at").catch(() => ({
      lastUpdatedAt: null,
    })),
  ]);

  console.log(`[manual] players loaded ${manualPlayers.length}: ${MANUAL_PLAYERS_PATH}`);

  const db = initFirebase();
  const rootRef = db.ref(FIREBASE_ROOT);
  const existingMeta = await readExistingMeta(rootRef).catch((error) => {
    console.warn(`[firebase] existing meta read failed: ${error.message}`);
    return {};
  });

  const effectiveRecordSyncMode = resolveEffectiveRecordSyncMode(existingMeta);

  console.log("[record sync mode]", {
    requested: RECORD_SYNC_MODE,
    effective: effectiveRecordSyncMode,
    existingBackfillVersion: Number(existingMeta.recordsBackfillVersion || 0),
    requiredBackfillVersion: RECORD_BACKFILL_VERSION,
  });

  console.log("[2/6] 선택적 이미지 캐시 처리");

  if (CACHE_LOCAL_ASSETS) {
    let imageOk = 0;

    await mapLimit(manualPlayers, 12, async (player) => {
      const target = path.join(profileDir, `${player.userId}.jpg`);
      const ok = await download(player.sourceImage || player.image, target).catch(() => false);
      if (ok) imageOk += 1;
    });

    console.log(`profile image cached: ${imageOk}/${manualPlayers.length}`);
  }

  console.log("[3/6] SOOP 방송국 상태 확인 시작");

  const stationChecks = await mapLimit(manualPlayers, 12, async (player) => {
    const station = player.station || `https://www.sooplive.com/station/${player.userId}`;

    const result = await getText(station).catch((error) => ({
      status: 0,
      error: error.message,
    }));

    return {
      userId: player.userId,
      status: result.status,
    };
  });

  const stationStatus = new Map(stationChecks.map((item) => [item.userId, item.status]));

  const players = manualPlayers.map((player) => ({
    ...player,
    stationStatus: stationStatus.get(player.userId) || player.stationStatus || 0,
    live: false,
    broad: null,
    broadcastUrl: "",
  }));

  console.log(`[4/6] ELO 전적 증분 수집 시작: ${players.length}명`);

  const existingRecordMeta = await readExistingRecordMeta(rootRef).catch((error) => {
    console.warn(`[firebase] recordMeta read failed: ${error.message}`);
    return {};
  });

  const recordMetaState = { ...existingRecordMeta };
  const recordReplacements = {};
  const recordAppends = {};
  const recordStorageUploads = {};
  const recordPreserveReadFailed = {};

  let recordFetchPlayerCount = 0;
  let recordFetchRowCount = 0;
  let recordFailCount = 0;
  let recordSkipCount = 0;
  let recordPreservedPlayerCount = 0;
  let recordPreservedRowCount = 0;
  let recordPreserveReadFailCount = 0;
  let recordIncrementalNewRowCount = 0;
  let recordAjaxPageCount = 0;
  let recordMetaBootstrapCount = 0;
  let recordCheckpointMissCount = 0;
  let recordAppendPlayerCount = 0;
  let recordAppendRowCount = 0;
  let recordReplacePlayerCount = 0;
  let recordReplaceRowCount = 0;

  await mapLimit(players, RECORD_CONCURRENCY, async (player, index) => {
    const key = safeKey(`${player.userId}_${player.race}`);
    const url = eloboardRecordUrl(player);
    const previousMeta = normalizeRecordMetaEntry(recordMetaState[key]);

    if (!url) {
      recordSkipCount += 1;
      console.warn(`[records skip] ${player.name}(${player.userId}/${player.race}): ELO URL 없음`);

      if ((index + 1) % 25 === 0 || index + 1 === players.length) {
        console.log(`records ${index + 1}/${players.length}`);
      }

      return;
    }

    try {
      if (effectiveRecordSyncMode === "full") {
        const result = await fetchRecordsFull(player);
        const rows = normalizeRecordRows(result.rows);

        if (rows.length === 0) throw new Error("ELOBOARD parsed 0 rows");

        recordReplacements[key] = rows;
        queueRecordStorageUpload(recordStorageUploads, key, rows);
        recordMetaState[key] = buildRecordMetaEntry(rows, player, {
          nextRowIndex: rows.length,
        });
        recordReplacePlayerCount += 1;
        recordReplaceRowCount += rows.length;
        recordFetchPlayerCount += 1;
        recordFetchRowCount += rows.length;
        recordAjaxPageCount += Number(result.morePagesFetched || 0);

        console.log(
          `[records full] ${player.name}(${player.userId}/${player.race}) rows=${rows.length} ajaxPages=${result.morePagesFetched || 0}`
        );
      } else if (
        previousMeta.schemaVersion !== RECORD_META_SCHEMA_VERSION ||
        previousMeta.recordCount <= 0 ||
        previousMeta.recentRecordIds.length === 0
      ) {
        // One-time migration: read this player's existing saved records once,
        // create compact checkpoint metadata, then stop downloading history on later runs.
        const existingState = await readExistingRecordStatePreferStorage(rootRef, key).catch((error) => {
          recordPreserveReadFailed[key] = true;
          recordPreserveReadFailCount += 1;
          throw error;
        });

        recordMetaBootstrapCount += 1;

        if (existingState.rows.length > 0) {
          const result = await fetchRecordsIncremental(player, existingState.rows);
          const rows = normalizeRecordRows(result.rows);
          const newRowCount = Number(result.newRowCount || 0);

          recordMetaState[key] = buildRecordMetaEntry(rows, player, {
            nextRowIndex: rows.length,
          });
          queueRecordStorageUpload(recordStorageUploads, key, rows);

          if (newRowCount > 0) {
            recordReplacements[key] = rows;
            recordReplacePlayerCount += 1;
            recordReplaceRowCount += rows.length;
          }

          recordIncrementalNewRowCount += newRowCount;
          recordFetchPlayerCount += 1;
          recordFetchRowCount += newRowCount;
          recordAjaxPageCount += Number(result.morePagesFetched || 0);

          console.log(
            `[records bootstrap] ${player.name}(${player.userId}/${player.race}) kept=${rows.length} new=${newRowCount}`
          );
        } else {
          const result = await fetchRecordsFull(player);
          const rows = normalizeRecordRows(result.rows);

          if (rows.length === 0) throw new Error("ELOBOARD parsed 0 rows");

          recordReplacements[key] = rows;
          queueRecordStorageUpload(recordStorageUploads, key, rows);
          recordMetaState[key] = buildRecordMetaEntry(rows, player, {
            nextRowIndex: rows.length,
          });
          recordReplacePlayerCount += 1;
          recordReplaceRowCount += rows.length;
          recordFetchPlayerCount += 1;
          recordFetchRowCount += rows.length;
          recordAjaxPageCount += Number(result.morePagesFetched || 0);

          console.log(
            `[records bootstrap full] ${player.name}(${player.userId}/${player.race}) rows=${rows.length}`
          );
        }
      } else {
        const result = await fetchRecordsIncrementalByCheckpoint(player, previousMeta);
        recordAjaxPageCount += Number(result.morePagesFetched || 0);

        if (result.checkpointMiss) {
          // Rare safety fallback. This happens when more new rows exist than the
          // recent checkpoint window can safely bridge. Preserve old rows by
          // reading them once and replacing with a merged snapshot.
          recordCheckpointMissCount += 1;
          const existingState = await readExistingRecordStatePreferStorage(rootRef, key);
          const fullResult = await fetchRecordsFull(player);
          const rows = mergeRecordRows(fullResult.rows, existingState.rows, player);

          if (rows.length === 0) throw new Error("checkpoint fallback parsed 0 rows");

          recordReplacements[key] = rows;
          queueRecordStorageUpload(recordStorageUploads, key, rows);
          recordMetaState[key] = buildRecordMetaEntry(rows, player, {
            nextRowIndex: rows.length,
          });
          recordReplacePlayerCount += 1;
          recordReplaceRowCount += rows.length;
          recordFetchPlayerCount += 1;
          recordFetchRowCount += rows.length;
          recordAjaxPageCount += Number(fullResult.morePagesFetched || 0);

          console.warn(
            `[records checkpoint fallback] ${player.name}(${player.userId}/${player.race}) merged=${rows.length}`
          );
        } else {
          const newRows = normalizeRecordRows(result.rows);

          if (newRows.length > 0) {
            let storageRows = null;
            if (TIER_RECORD_STORAGE_UPLOAD) {
              const existingState = await readExistingRecordStatePreferStorage(rootRef, key);
              if (previousMeta.recordCount > 0 && existingState.rows.length === 0) {
                throw new Error("missing existing record snapshot for storage append");
              }
              storageRows = mergeRecordRows(newRows, existingState.rows, player);
            }

            recordAppends[key] = {
              startIndex: previousMeta.nextRowIndex,
              rows: newRows,
            };
            if (storageRows) queueRecordStorageUpload(recordStorageUploads, key, storageRows);
            recordMetaState[key] = advanceRecordMetaEntry(previousMeta, newRows, player);
            recordAppendPlayerCount += 1;
            recordAppendRowCount += newRows.length;
            recordIncrementalNewRowCount += newRows.length;
          }

          recordFetchPlayerCount += 1;
          recordFetchRowCount += newRows.length;

          console.log(
            `[records incremental] ${player.name}(${player.userId}/${player.race}) new=${newRows.length} ajaxPages=${result.morePagesFetched || 0}`
          );
        }
      }
    } catch (error) {
      recordFailCount += 1;
      recordPreserveReadFailed[key] = true;
      const preserved = normalizeRecordMetaEntry(recordMetaState[key]);

      if (preserved.recordCount > 0) {
        recordPreservedPlayerCount += 1;
        recordPreservedRowCount += preserved.recordCount;
      }

      console.warn(
        `[records fail preserve] ${player.name}(${player.userId}/${player.race}) kept=${preserved.recordCount}: ${error.message}`
      );
    }

    if ((index + 1) % 25 === 0 || index + 1 === players.length) {
      console.log(`records ${index + 1}/${players.length}`);
    }
  });

  console.log("[5/6] Firebase 업로드 데이터 구성");

  const activityNow = new Date();
  const playersWithRecordStatus = players.map((player) => {
    const key = safeKey(`${player.userId}_${player.race}`);
    const playerRecordMeta = normalizeRecordMetaEntry(recordMetaState[key]);
    const lastRecordDate = playerRecordMeta.lastRecordDate;
    const preserveReadFailed = recordPreserveReadFailed[key] === true;
    const youthTierExempt = isYouthTierPlayer(player);
    const recordInactive = youthTierExempt
      ? false
      : preserveReadFailed && playerRecordMeta.recordCount === 0
        ? false
        : isInactiveByLastRecordDate(lastRecordDate, activityNow);

    return {
      ...player,
      recordKey: key,
      recordCount: playerRecordMeta.recordCount,
      lastRecordDate,
      recordInactive,
      recordInactiveExempt: youthTierExempt ? "youth-tier" : "",
      recordPreserveReadFailed: preserveReadFailed,
      hiddenByRecordInactivity: HIDE_INACTIVE_PLAYERS && recordInactive,
      recordVisibility:
        HIDE_INACTIVE_PLAYERS && recordInactive
          ? "hidden-inactive-records"
          : "visible",
    };
  });

  const visiblePlayers = HIDE_INACTIVE_PLAYERS
    ? playersWithRecordStatus.filter((player) => !player.hiddenByRecordInactivity)
    : playersWithRecordStatus;

  const hiddenInactivePlayers = playersWithRecordStatus.filter(
    (player) => player.hiddenByRecordInactivity
  );

  const winRates = buildWinRates(visiblePlayers);
  const nowIso = new Date().toISOString();
  const recordMetaEntries = Object.values(recordMetaState).map(normalizeRecordMetaEntry);
  const recordPlayerCount = recordMetaEntries.filter((entry) => entry.recordCount > 0).length;
  const recordRowCount = recordMetaEntries.reduce((sum, entry) => sum + entry.recordCount, 0);
  const recordUploadPlayerCount = recordReplacePlayerCount + recordAppendPlayerCount;
  const recordUploadRowCount = recordReplaceRowCount + recordAppendRowCount;

  const existingBackfillVersion = Number(existingMeta.recordsBackfillVersion || 0);
  const completedBackfillThisRun = effectiveRecordSyncMode === "full";
  const recordsBackfillComplete =
    existingBackfillVersion >= RECORD_BACKFILL_VERSION || completedBackfillThisRun;
  const recordsBackfillVersion = recordsBackfillComplete
    ? Math.max(existingBackfillVersion, RECORD_BACKFILL_VERSION)
    : existingBackfillVersion;
  const recordsBackfilledAt = completedBackfillThisRun
    ? nowIso
    : existingMeta.recordsBackfilledAt || null;
  const recordsBackfillCompletedWithFailures = completedBackfillThisRun && recordFailCount > 0;

  const meta = {
    collectedAt: nowIso,
    syncedAt: nowIso,
    updatedAt: nowIso,
    sourceLastUpdatedAt: lastUpdated.lastUpdatedAt || null,
    eloboardUpdatedAt: lastUpdated.lastUpdatedAt || null,
    playerCount: visiblePlayers.length,
    sourcePlayerCount: players.length,
    hiddenInactivePlayerCount: hiddenInactivePlayers.length,
    hiddenInactivePlayers: hiddenInactivePlayers.map((player) => ({
      userId: player.userId,
      name: player.name,
      race: player.race,
      tier: player.tier,
      lastRecordDate: player.lastRecordDate,
      recordCount: player.recordCount,
    })),
    hideInactivePlayers: HIDE_INACTIVE_PLAYERS,
    inactiveRecordMonths: INACTIVE_RECORD_MONTHS,
    liveCount: 0,
    stationVisitedCount: stationChecks.filter((item) => item.status >= 200 && item.status < 400).length,
    recordPlayerCount,
    recordRowCount,
    recordFetchPlayerCount,
    recordFetchRowCount,
    recordPreservedPlayerCount,
    recordPreservedRowCount,
    recordPreserveReadFailCount,
    recordUploadPlayerCount,
    recordUploadRowCount,
    recordFailCount,
    recordSkipCount,
    recordIncrementalNewRowCount,
    recordAjaxPageCount,
    recordMetaSchemaVersion: RECORD_META_SCHEMA_VERSION,
    recordMetaRecentIdLimit: RECORD_META_RECENT_ID_LIMIT,
    recordMetaBootstrapCount,
    recordCheckpointMissCount,
    recordAppendPlayerCount,
    recordAppendRowCount,
    recordReplacePlayerCount,
    recordReplaceRowCount,
    recordsBackfillVersion,
    recordsBackfillComplete,
    recordsBackfilledAt,
    recordsBackfillCompletedWithFailures,
    recordSyncMode: RECORD_SYNC_MODE,
    effectiveRecordSyncMode,
    headToHeadMode: "frontend-computed-from-selected-player-records",
    headToHeadCount: 0,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    recordConcurrency: RECORD_CONCURRENCY,
    recordMaxPages: RECORD_MAX_PAGES,
    recordFullMaxPages: RECORD_FULL_MAX_PAGES,
    recordIncrementalMaxPages: RECORD_INCREMENTAL_MAX_PAGES,
    eloboardMaxRowsPerPlayer: ELOBOARD_MAX_ROWS_PER_PLAYER,
    firebaseRecordRowsUpload: FIREBASE_RECORD_ROWS_UPLOAD,
    recordStorageUploadEnabled: TIER_RECORD_STORAGE_UPLOAD,
    recordStorageRequired: TIER_RECORD_STORAGE_REQUIRED,
    recordStorageBucket: TIER_RECORD_STORAGE_BUCKET,
    recordStoragePrefix: TIER_RECORD_STORAGE_PREFIX,
    recordStoragePlannedPlayerCount: Object.keys(recordStorageUploads).length,
    source: "manual-players + direct-eloboard-ajax + compact-recordMeta + storage-records",
    playerSource: "data/manual/players.json",
    liveSource: "preserved-from-soop-sync",
  };

  console.log("[5.5/6] Supabase Storage 전적 gzip 업로드");
  const recordStorageUploadStats = await uploadRecordStorageFiles(recordStorageUploads);
  console.log("[5.6/6] Supabase 상대전적 요약 인덱스 업로드");
  const headToHeadSummaryStats = await uploadHeadToHeadSummaries(
    visiblePlayers,
    recordStorageUploads
  );
  Object.assign(meta, {
    recordStorageUploadAttempted: recordStorageUploadStats.attempted,
    recordStorageUploadSucceeded: recordStorageUploadStats.succeeded,
    recordStorageUploadFailed: recordStorageUploadStats.failed,
    recordStorageUploadGzipBytes: recordStorageUploadStats.totalGzipBytes,
    headToHeadMode: TIER_HEAD_TO_HEAD_SUMMARY_UPLOAD
      ? "supabase-db-summary-with-storage-fallback"
      : "frontend-computed-from-selected-player-records",
    headToHeadSummaryUploadEnabled: TIER_HEAD_TO_HEAD_SUMMARY_UPLOAD,
    headToHeadSummaryRebuildAll: headToHeadSummaryStats.rebuildAll,
    headToHeadSummaryUploadAttempted: headToHeadSummaryStats.attempted,
    headToHeadSummaryUploadSucceeded: headToHeadSummaryStats.succeeded,
    headToHeadSummaryUploadFailed: headToHeadSummaryStats.failed,
    headToHeadSummaryStorageReadSucceeded: headToHeadSummaryStats.storageReadSucceeded,
    headToHeadSummaryStorageReadEmpty: headToHeadSummaryStats.storageReadEmpty,
    headToHeadSummaryStorageReadFailed: headToHeadSummaryStats.storageReadFailed,
    headToHeadCount: headToHeadSummaryStats.succeeded,
  });

  const payload = {
    meta,
    players: visiblePlayers,
    recordMeta: recordMetaState,
    recordReplacements,
    recordAppends,
    winRates,
  };

  if (CACHE_LOCAL_JSON) {
    await fs.writeFile(path.join(dataDir, "players.json"), JSON.stringify({ meta, players: visiblePlayers }, null, 2));
    await fs.writeFile(path.join(dataDir, "record-meta.json"), JSON.stringify(recordMetaState, null, 2));
    await fs.writeFile(path.join(dataDir, "records-replacements.json"), JSON.stringify(recordReplacements));
    await fs.writeFile(path.join(dataDir, "record-appends.json"), JSON.stringify(recordAppends));
    await fs.writeFile(path.join(dataDir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  console.log(`[6/6] Firebase 업로드 시작: ${FIREBASE_ROOT}`);

  const uploadedMeta = await uploadToFirebase(payload);

  run.status =
    recordFailCount > 0 ||
    recordStorageUploadStats.failed > 0 ||
    headToHeadSummaryStats.failed > 0
      ? "partial"
      : "success";
  run.itemsFound = players.length;
  run.itemsWritten =
    visiblePlayers.length +
    recordUploadRowCount +
    recordStorageUploadStats.succeeded +
    headToHeadSummaryStats.succeeded;
  run.itemsSkipped =
    recordSkipCount +
    recordFailCount +
    hiddenInactivePlayers.length +
    recordStorageUploadStats.failed +
    headToHeadSummaryStats.failed;
  run.meta = {
    firebaseRoot: FIREBASE_ROOT,
    recordSyncMode: RECORD_SYNC_MODE,
    effectiveRecordSyncMode,
    playerCount: visiblePlayers.length,
    sourcePlayerCount: players.length,
    recordRowCount,
    recordUploadRowCount,
    recordStorageUploadSucceeded: recordStorageUploadStats.succeeded,
    recordStorageUploadFailed: recordStorageUploadStats.failed,
    headToHeadSummaryRebuildAll: headToHeadSummaryStats.rebuildAll,
    headToHeadSummaryUploadSucceeded: headToHeadSummaryStats.succeeded,
    headToHeadSummaryUploadFailed: headToHeadSummaryStats.failed,
    headToHeadSummaryStorageReadSucceeded: headToHeadSummaryStats.storageReadSucceeded,
    headToHeadSummaryStorageReadEmpty: headToHeadSummaryStats.storageReadEmpty,
    headToHeadSummaryStorageReadFailed: headToHeadSummaryStats.storageReadFailed,
    firebaseRecordRowsUpload: FIREBASE_RECORD_ROWS_UPLOAD,
    recordFailCount,
    recordSkipCount,
    hiddenInactivePlayerCount: hiddenInactivePlayers.length
  };

  console.log(
    JSON.stringify(
      {
        ok: true,
        firebaseRoot: FIREBASE_ROOT,
        meta: uploadedMeta,
      },
      null,
      2
    )
  );
}

withAutomationLog({
  jobName: "collect-tier-data",
  jobType: process.env.GITHUB_EVENT_NAME || "scheduled",
  source: "manual-players+eloboard",
  target: TIER_RECORD_STORAGE_UPLOAD ? "firebase+supabase-storage" : "firebase",
  meta: {
    firebaseRoot: FIREBASE_ROOT,
    recordSyncMode: RECORD_SYNC_MODE,
    tierRecordStorageUpload: TIER_RECORD_STORAGE_UPLOAD,
    firebaseRecordRowsUpload: FIREBASE_RECORD_ROWS_UPLOAD
  }
}, main)
  .then(async () => {
    await Promise.race([closeFirebase(), sleep(3000)]);
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await Promise.race([closeFirebase(), sleep(3000)]);
    process.exit(1);
  });
