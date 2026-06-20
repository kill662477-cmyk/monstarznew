// 관리자 API (catch-all). 모든 /api/admin/* 요청을 하나의 서버리스 함수로 처리합니다.
// (Vercel Hobby 함수 개수 제한 대응)
//
// 보안:
//  - 쓰기/조회는 ADMIN_SECRET 으로 발급한 httpOnly 쿠키가 있어야 동작
//  - Supabase 쓰기는 서버 전용 service/secret 키로만 (lib/supabase/admin.js)
//  - service 키 / ADMIN_SECRET 은 절대 응답 본문이나 브라우저로 노출하지 않음
//  - 실제 삭제 없음(soft delete: is_visible=false, hidden_at)
//
// 라우트(논리):
//  POST   /api/admin/auth/login      { code }      -> 쿠키 발급
//  POST   /api/admin/auth/logout                   -> 쿠키 삭제
//  GET    /api/admin/auth/status                   -> 로그인 여부 + supabase 연결 여부
//  GET    /api/admin/<resource>                    -> 목록(숨김 포함)
//  POST   /api/admin/<resource>      { ...fields } -> 추가
//  PATCH  /api/admin/<resource>/:id  { ...fields } -> 수정
//  PATCH  /api/admin/<resource>/:id/hide           -> 숨김(soft delete)
//  PATCH  /api/admin/<resource>/:id/restore        -> 복구
//  PATCH  /api/admin/notices/:id/pin { pinned }    -> 고정 토글
//  PATCH  /api/admin/videos/:id/pin  { pinned }    -> 고정 토글
//  PATCH  /api/admin/links/reorder   { orders:[{id,sort_order}] } -> 정렬
//  POST   /api/admin/newcam-match-entry { match, games } -> 뉴캄 경기 + 세트별 선수 결과 일괄 등록

const crypto = require("crypto");
const { getServerConfig, getPublicConfig } = require("../../lib/supabase/server");
const admin = require("../../lib/supabase/admin");
const { checkRateLimit } = require("../_shared/rateLimit");

const COOKIE_NAME = "mz_admin";
const MAX_BODY_BYTES = 64 * 1024;
const NEWCAM_MAPS = ["폴리포이드", "라데온", "녹아웃", "네오 실피드"];
const NEWCAM_MATCH_TYPES = ["scrim", "official", "final"];
const NEWCAM_GROUPS = ["", "A", "B", "FINAL"];
const NEWCAM_STATUSES = ["scheduled", "done", "cancelled"];

const RESOURCES = {
  members: { table: "members_admin" },
  profiles: { table: "member_profiles" },
  schedules: { table: "schedules" },
  videos: { table: "videos" },
  notices: { table: "notices_meta" },
  inout: { table: "inout_events" },
  links: { table: "external_links" },
  resources: { table: "resources" },
  newcamTeams: { table: "newcam_teams" },
  newcamPlayers: { table: "newcam_players" },
  newcamMatches: { table: "newcam_matches" },
  newcamMatchPlayers: { table: "newcam_match_players" }
};

// 입력으로 받을 수 있는 컬럼 화이트리스트 (그 외 키는 무시)
const FIELD_WHITELIST = {
  members_admin: ["member_code", "name", "race", "tier", "role", "soop_id", "youtube_url", "profile_image", "sort_order", "is_visible"],
  member_profiles: ["member_code", "name", "role", "image", "fallback_image", "image_pos", "birth", "blood", "mbti", "height", "debut", "awards", "sort_order", "is_visible"],
  schedules: ["title", "start_at", "end_at", "event_date", "description", "members", "status", "sort_order", "is_visible"],
  videos: ["title", "platform", "member_code", "url", "published_at", "thumbnail", "is_pinned", "sort_order", "is_visible"],
  notices_meta: ["source_key", "title", "station_name", "link", "notice_date", "is_pinned", "sort_order", "is_visible"],
  inout_events: ["member_name", "event_type", "event_date", "race", "description", "sort_order", "is_visible"],
  external_links: ["title", "url", "category", "note", "sort_order", "is_visible"],
  resources: ["title", "url", "category", "description", "sort_order", "is_visible"],
  newcam_teams: ["team_key", "team_name", "captain_name", "group_name", "sort_order", "is_visible"],
  newcam_players: ["team_key", "player_name", "tier_label", "role_label", "race", "auction_points", "wins", "losses", "is_temporary", "sort_order", "is_visible"],
  newcam_matches: ["match_type", "group_name", "round_label", "team_a_key", "team_b_key", "winner_team_key", "played_at", "status", "sort_order", "is_visible"],
  newcam_match_players: ["match_id", "match_type", "game_no", "map_name", "team_key", "player_name", "opponent_name", "result", "sort_order", "is_visible"]
};

function expectedToken() {
  const secret = process.env.ADMIN_SECRET || "";
  if (!secret) return "";
  return crypto.createHash("sha256").update("mz::" + secret).digest("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach(function (part) {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isAuthed(req) {
  const expected = expectedToken();
  if (!expected) return false; // ADMIN_SECRET 미설정이면 항상 비인증
  const token = parseCookies(req)[COOKIE_NAME] || "";
  return timingSafeEqual(token, expected);
}

function setAuthCookie(res, value, maxAgeSec) {
  const parts = [
    COOKIE_NAME + "=" + value,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Max-Age=" + maxAgeSec
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) throw validationError("요청 본문이 너무 큽니다.");
    try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
  }
  // 스트림 직접 파싱 (일부 런타임)
  return await new Promise(function (resolve, reject) {
    let raw = "";
    req.on("data", function (c) {
      raw += c;
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
        reject(validationError("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", function () {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
    req.on("error", function () { resolve({}); });
  });
}

function pickFields(table, body) {
  const allow = FIELD_WHITELIST[table] || [];
  const out = {};
  allow.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined) out[k] = body[k];
  });
  return out;
}

function ok(res, data) {
  return res.status(200).json({ ok: true, data: data === undefined ? null : data, updatedAt: new Date().toISOString() });
}
function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error: error, code: String(error || "ERROR").toUpperCase(), message: message || error });
}

function validationError(message) {
  const err = new Error(message || "입력값을 확인해주세요.");
  err.status = 400;
  err.code = "invalid_payload";
  return err;
}

function safeText(value, field) {
  if (value === null || value === undefined) return value;
  const text = String(value).replace(/\u0000/g, "").trim();
  const max = field === "description" ? 4000 : 700;
  if (text.length > max) throw validationError(field + " 값이 너무 깁니다.");
  return text;
}

function safeUrl(value, field) {
  const text = safeText(value, field);
  if (!text) return text;
  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    throw validationError(field + " URL 형식이 올바르지 않습니다.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw validationError(field + " URL은 http/https만 허용됩니다.");
  }
  return parsed.href;
}

function normalizePayload(table, payload) {
  const out = {};
  Object.keys(payload).forEach(function (key) {
    const value = payload[key];
    if (key === "sort_order") {
      out[key] = Math.max(-9999, Math.min(9999, Number(value) || 0));
      return;
    }
    if (key === "is_visible" || key === "is_pinned") {
      out[key] = value === true || value === "true" || value === 1;
      return;
    }
    if (key === "url" || key === "link" || key === "youtube_url" || key === "profile_image" || key === "thumbnail") {
      out[key] = safeUrl(value, key);
      return;
    }
    if (key === "members" && Array.isArray(value)) {
      if (value.length > 80) throw validationError("members 항목이 너무 많습니다.");
      out[key] = value.map(function (item) { return safeText(item, key); }).filter(Boolean);
      return;
    }
    out[key] = safeText(value, key);
  });
  return out;
}

function cleanChoice(value, allowed, fallback, field) {
  const text = safeText(value, field) || "";
  if (!text) return fallback || "";
  if (!allowed.includes(text)) throw validationError(field + " 값이 올바르지 않습니다.");
  return text;
}

function normalizeDateTime(value) {
  const text = safeText(value, "played_at") || "";
  if (!text) return new Date().toISOString();
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw validationError("경기 시간 값이 올바르지 않습니다.");
  return date.toISOString();
}

function normalizeNewcamMatchEntry(body) {
  const matchInput = body && typeof body.match === "object" ? body.match : (body || {});
  const matchType = cleanChoice(matchInput.match_type || "scrim", NEWCAM_MATCH_TYPES, "scrim", "match_type");
  const groupName = cleanChoice(matchInput.group_name || "", NEWCAM_GROUPS, "", "group_name");
  const status = cleanChoice(matchInput.status || "done", NEWCAM_STATUSES, "done", "status");
  const teamA = safeText(matchInput.team_a_key, "team_a_key");
  const teamB = safeText(matchInput.team_b_key, "team_b_key");
  if (!teamA || !teamB) throw validationError("A팀과 B팀을 선택해주세요.");
  if (teamA === teamB) throw validationError("A팀과 B팀은 서로 달라야 합니다.");

  const games = Array.isArray(body && body.games) ? body.games : [];
  if (games.length > 9) throw validationError("세트는 최대 9개까지만 등록할 수 있습니다.");

  let aWins = 0;
  let bWins = 0;
  const rows = [];
  games.forEach(function (game, index) {
    const gameNo = Math.max(1, Math.min(9, Number(game && game.game_no) || (index + 1)));
    const mapName = safeText(game && game.map_name, "map_name") || "";
    const aPlayer = safeText(game && (game.a_player_name || game.player_a_name || game.a_player), "a_player_name") || "";
    const bPlayer = safeText(game && (game.b_player_name || game.player_b_name || game.b_player), "b_player_name") || "";
    const winnerSide = String((game && (game.winner_side || game.winner)) || "").trim().toUpperCase();
    const hasAnyValue = Boolean(mapName || aPlayer || bPlayer || winnerSide);
    if (!hasAnyValue) return;
    if (!mapName || !NEWCAM_MAPS.includes(mapName)) throw validationError(gameNo + "세트 맵을 선택해주세요.");
    if (!aPlayer || !bPlayer) throw validationError(gameNo + "세트 A/B 선수를 모두 입력해주세요.");
    if (!["A", "B"].includes(winnerSide)) throw validationError(gameNo + "세트 승자를 선택해주세요.");

    const aWin = winnerSide === "A";
    if (aWin) aWins += 1;
    else bWins += 1;
    rows.push({
      match_type: matchType,
      game_no: gameNo,
      map_name: mapName,
      team_key: teamA,
      player_name: aPlayer,
      opponent_name: bPlayer,
      result: aWin ? "win" : "loss",
      sort_order: gameNo * 10,
      is_visible: true
    });
    rows.push({
      match_type: matchType,
      game_no: gameNo,
      map_name: mapName,
      team_key: teamB,
      player_name: bPlayer,
      opponent_name: aPlayer,
      result: aWin ? "loss" : "win",
      sort_order: gameNo * 10 + 1,
      is_visible: true
    });
  });

  if (!rows.length) throw validationError("저장할 세트 결과가 없습니다.");
  const winnerTeam = aWins > bWins ? teamA : (bWins > aWins ? teamB : "");
  const sortOrder = Number(matchInput.sort_order) || Math.floor(Date.now() / 1000);
  return {
    match: {
      match_type: matchType,
      group_name: groupName,
      round_label: safeText(matchInput.round_label, "round_label") || "",
      team_a_key: teamA,
      team_b_key: teamB,
      winner_team_key: winnerTeam,
      played_at: normalizeDateTime(matchInput.played_at),
      status: status,
      sort_order: sortOrder,
      is_visible: true
    },
    rows: rows,
    score: { a: aWins, b: bWins, winner_team_key: winnerTeam }
  };
}

async function createNewcamMatchEntry(body) {
  const normalized = normalizeNewcamMatchEntry(body);
  const createdMatchRows = await admin.insertRow("newcam_matches", normalized.match);
  const match = Array.isArray(createdMatchRows) ? createdMatchRows[0] : createdMatchRows;
  if (!match || !match.id) throw validationError("경기 저장 결과를 확인하지 못했습니다.");
  const playerRows = normalized.rows.map(function (row) {
    return Object.assign({}, row, { match_id: match.id });
  });
  try {
    const createdPlayers = await admin.rest("POST", "newcam_match_players", {
      body: playerRows,
      prefer: "return=representation"
    });
    return {
      match: match,
      matchPlayers: Array.isArray(createdPlayers) ? createdPlayers : [],
      games: playerRows.length / 2,
      score: normalized.score
    };
  } catch (error) {
    await admin.softDelete("newcam_matches", match.id).catch(function () {});
    throw error;
  }
}

async function systemHealth(req) {
  const serverCfg = getServerConfig();
  const publicCfg = getPublicConfig();
  const env = {
    adminSecret: Boolean(process.env.ADMIN_SECRET),
    supabaseUrl: Boolean(serverCfg.url || publicCfg.url),
    supabaseServiceRole: Boolean(serverCfg.serviceKey),
    supabasePublicKey: Boolean(publicCfg.anonKey),
    firebaseDatabaseUrl: Boolean(process.env.FIREBASE_DATABASE_URL),
    firebaseServiceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS),
    soopClientId: Boolean(process.env.SOOP_CLIENT_ID),
    soopClientSecret: Boolean(process.env.SOOP_CLIENT_SECRET),
  };

  let latestAutomation = null;
  let automationError = "";
  if (serverCfg.ready) {
    try {
      const rows = await admin.rest("GET", "automation_runs", { query: "?select=job_name,status,finished_at,created_at,error_message&order=created_at.desc&limit=1" });
      latestAutomation = Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (error) {
      automationError = "automation_runs_unavailable";
    }
  }

  return {
    supabase: { serverReady: serverCfg.ready, publicReady: publicCfg.ready },
    firebase: { configured: env.firebaseDatabaseUrl || env.firebaseServiceAccount },
    githubActions: { automationLogReady: Boolean(latestAutomation), latest: latestAutomation, error: automationError },
    api: {
      admin: "protected",
      publicOverrides: serverCfg.ready ? "ready" : "fallback",
      scheduleToday: "cached",
    },
    cachePolicy: {
      liveSeconds: 45,
      scheduleSeconds: 180,
      noticesSeconds: 180,
      videosSeconds: 900,
      membersSeconds: 1800,
      historySeconds: 2700,
      linksSeconds: 3600,
    },
    env,
    note: "Secret 값은 표시하지 않고 설정 여부만 반환합니다.",
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // 경로는 vercel.json 리라이트로 ?path=auth/status 형태로 전달된다.
  // (정적 프로젝트에서는 [...catch-all] 라우팅이 동작하지 않으므로 리라이트 사용)
  const rawPath = req.query && req.query.path;
  const segments = (Array.isArray(rawPath) ? rawPath : String(rawPath || "").split("/"))
    .map(function (s) { return String(s); })
    .filter(Boolean);

  const method = req.method;
  const isWriteMethod = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
  if (!checkRateLimit(req, res, { name: "admin-api", max: isWriteMethod ? 90 : 240, windowMs: 60 * 1000 })) return;

  // ---- auth ----
  if (segments[0] === "auth") {
    const action = segments[1] || "status";

    if (action === "status" && method === "GET") {
      return res.status(200).json({
        ok: true,
        authed: isAuthed(req),
        adminConfigured: Boolean(process.env.ADMIN_SECRET),
        supabaseReady: getServerConfig().ready,
        supabasePublicReady: getPublicConfig().ready
      });
    }

    if (action === "login" && method === "POST") {
      if (!checkRateLimit(req, res, { name: "admin-login", max: 8, windowMs: 60 * 1000 })) return;
      if (!process.env.ADMIN_SECRET) return fail(res, 503, "admin_not_configured", "ADMIN_SECRET 환경변수가 설정되지 않았습니다.");
      const body = await readJsonBody(req);
      const code = (body && body.code) || "";
      if (!timingSafeEqual(code, process.env.ADMIN_SECRET)) return fail(res, 401, "invalid_code", "관리자 코드가 올바르지 않습니다.");
      setAuthCookie(res, expectedToken(), 60 * 60 * 8); // 8시간
      return ok(res, { authed: true });
    }

    if (action === "logout" && method === "POST") {
      setAuthCookie(res, "", 0);
      return ok(res, { authed: false });
    }

    return fail(res, 405, "method_not_allowed");
  }

  // ---- 이하 모든 리소스 작업은 인증 필요 ----
  if (!isAuthed(req)) return fail(res, 401, "unauthorized", "관리자 인증이 필요합니다.");

  const resourceKey = segments[0];
  const resource = RESOURCES[resourceKey];

  if (resourceKey === "system-health" && method === "GET") {
    try {
      return ok(res, await systemHealth(req));
    } catch (e) {
      return handleError(res, e);
    }
  }

  // links/reorder
  if (resourceKey === "links" && segments[1] === "reorder" && method === "PATCH") {
    try {
      const body = await readJsonBody(req);
      const orders = Array.isArray(body.orders) ? body.orders : [];
      if (orders.length > 200) return fail(res, 400, "invalid_payload", "정렬 항목이 너무 많습니다.");
      const results = [];
      for (let i = 0; i < orders.length; i++) {
        const item = orders[i];
        if (!item || !item.id) continue;
        results.push(await admin.updateRow("external_links", item.id, { sort_order: Number(item.sort_order) || 0 }));
      }
      return ok(res, { updated: results.length });
    } catch (e) {
      return handleError(res, e);
    }
  }

  // 자동화 실행 로그 조회 (읽기 전용)
  if (resourceKey === "automation" && method === "GET") {
    try {
      const data = await admin.rest("GET", "automation_runs", { query: "?select=*&order=created_at.desc&limit=30" });
      return ok(res, data);
    } catch (e) {
      return handleError(res, e);
    }
  }

  if (resourceKey === "newcam-match-entry" && method === "POST") {
    try {
      const body = await readJsonBody(req);
      return ok(res, await createNewcamMatchEntry(body));
    } catch (e) {
      return handleError(res, e);
    }
  }

  if (!resource) return fail(res, 404, "not_found", "알 수 없는 리소스입니다.");
  const table = resource.table;
  const id = segments[1];
  const subAction = segments[2];

  try {
    // GET /admin/<resource>
    if (method === "GET" && !id) {
      const data = await admin.adminSelect(table, { includeHidden: true });
      return ok(res, data);
    }

    // POST /admin/<resource>
    if (method === "POST" && !id) {
      const body = await readJsonBody(req);
      const payload = normalizePayload(table, pickFields(table, body));
      if (!Object.keys(payload).length) return fail(res, 400, "empty_payload", "저장할 값이 없습니다.");
      const data = await admin.insertRow(table, payload);
      return ok(res, data);
    }

    // PATCH /admin/<resource>/:id ...
    if (method === "PATCH" && id) {
      if (subAction === "hide") {
        return ok(res, await admin.softDelete(table, id));
      }
      if (subAction === "restore") {
        return ok(res, await admin.restore(table, id));
      }
      if (subAction === "pin") {
        const body = await readJsonBody(req);
        const pinned = body && typeof body.pinned === "boolean" ? body.pinned : true;
        return ok(res, await admin.updateRow(table, id, { is_pinned: pinned }));
      }
      // 일반 수정
      const body = await readJsonBody(req);
      const payload = normalizePayload(table, pickFields(table, body));
      if (!Object.keys(payload).length) return fail(res, 400, "empty_payload", "수정할 값이 없습니다.");
      return ok(res, await admin.updateRow(table, id, payload));
    }

    return fail(res, 405, "method_not_allowed");
  } catch (e) {
    return handleError(res, e);
  }
};

function handleError(res, e) {
  if (e && e.code === "supabase_not_configured") {
    return fail(res, 503, "supabase_not_configured", "Supabase 환경변수가 설정되지 않았습니다.");
  }
  if (e && e.code === "invalid_payload") {
    return fail(res, 400, "invalid_payload", e.message);
  }
  return fail(res, (e && e.status) || 500, "server_error", "관리자 데이터를 처리하지 못했습니다.");
}
