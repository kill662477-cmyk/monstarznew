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
//  GET    /api/admin/meta                         -> 활성 관리자 리소스/필드 메타
//  GET    /api/admin/audit                        -> 최근 관리자 변경 로그

const crypto = require("crypto");
const { getServerConfig, getPublicConfig } = require("../../lib/supabase/server");
const admin = require("../../lib/supabase/admin");
const { checkRateLimit } = require("../_shared/rateLimit");

const COOKIE_NAME = "mz_admin";
const MAX_BODY_BYTES = 64 * 1024;
const ADMIN_AUDIT_TABLE = "admin_audit_log";
const RESOURCES = {
  members: { table: "members_admin", label: "멤버", publicImpact: "현황판/프로필/방송 링크" },
  profiles: { table: "member_profiles", label: "프로필", publicImpact: "프로필 상세" },
  schedules: { table: "schedules", label: "일정", publicImpact: "일정표/홈 일정" },
  videos: { table: "videos", label: "영상", publicImpact: "팬튜브/기타영상" },
  notices: { table: "notices_meta", label: "공지", publicImpact: "공지 숨김/고정 보정" },
  inout: { table: "inout_events", label: "IN&OUT", publicImpact: "IN&OUT 히스토리" },
  links: { table: "external_links", label: "외부 링크", publicImpact: "외부 링크 목록" },
  resources: { table: "resources", label: "자료", publicImpact: "자료실" }
};

const RETIRED_RESOURCES = new Set([
  "newcamTeams",
  "newcamPlayers",
  "newcamMatches",
  "newcamMatchPlayers",
  "newcam-match-entry"
]);

// 입력으로 받을 수 있는 컬럼 화이트리스트 (그 외 키는 무시)
const FIELD_WHITELIST = {
  members_admin: ["member_code", "name", "race", "tier", "role", "soop_id", "youtube_url", "profile_image", "sort_order", "is_visible"],
  member_profiles: ["member_code", "name", "role", "image", "fallback_image", "image_pos", "birth", "blood", "mbti", "height", "debut", "awards", "sort_order", "is_visible"],
  schedules: ["title", "start_at", "end_at", "event_date", "description", "members", "status", "sort_order", "is_visible"],
  videos: ["title", "platform", "member_code", "url", "published_at", "thumbnail", "is_pinned", "sort_order", "is_visible"],
  notices_meta: ["source_key", "title", "station_name", "link", "notice_date", "is_pinned", "sort_order", "is_visible"],
  inout_events: ["member_name", "event_type", "event_date", "race", "description", "sort_order", "is_visible"],
  external_links: ["title", "url", "category", "note", "sort_order", "is_visible"],
  resources: ["title", "url", "category", "description", "sort_order", "is_visible"]
};

const REQUIRED_FIELDS = {
  members_admin: ["name"],
  member_profiles: ["name"],
  schedules: ["title"],
  videos: ["title", "url"],
  notices_meta: ["title"],
  inout_events: ["member_name", "event_type"],
  external_links: ["title", "url"],
  resources: ["title"]
};

const CHOICE_FIELDS = {
  race: ["", "T", "P", "Z"],
  event_type: ["IN", "OUT"],
  status: ["scheduled", "live", "done", "cancelled"]
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

function adminMetadata() {
  const resources = {};
  Object.keys(RESOURCES).forEach(function (key) {
    const info = RESOURCES[key];
    resources[key] = {
      key: key,
      table: info.table,
      label: info.label || key,
      publicImpact: info.publicImpact || "",
      fields: (FIELD_WHITELIST[info.table] || []).slice(),
      required: (REQUIRED_FIELDS[info.table] || []).slice(),
      actions: ["list", "create", "update", "hide", "restore"].concat(
        ["videos", "notices"].includes(key) ? ["pin"] : []
      )
    };
  });
  return {
    resources: resources,
    retired: Array.from(RETIRED_RESOURCES),
    softDelete: true,
    auditLog: ADMIN_AUDIT_TABLE
  };
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

function requireFields(table, payload, isCreate) {
  if (!isCreate) return;
  (REQUIRED_FIELDS[table] || []).forEach(function (field) {
    const value = payload[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw validationError(field + " 값이 필요합니다.");
    }
  });
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
    if (key === "is_visible" || key === "is_pinned" || key === "is_mercenary") {
      out[key] = value === true || value === "true" || value === 1;
      return;
    }
    if (key === "url" || key === "link" || key === "youtube_url" || key === "profile_image" || key === "thumbnail") {
      out[key] = safeUrl(value, key);
      return;
    }
    if (key === "event_date") {
      const text = safeText(value, key);
      if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw validationError(key + " 날짜 형식은 YYYY-MM-DD 여야 합니다.");
      out[key] = text || null;
      return;
    }
    if (key === "start_at" || key === "end_at" || key === "published_at") {
      const text = safeText(value, key);
      if (!text) {
        out[key] = null;
        return;
      }
      const date = new Date(text);
      if (Number.isNaN(date.getTime())) throw validationError(key + " 날짜/시간 형식이 올바르지 않습니다.");
      out[key] = date.toISOString();
      return;
    }
    if (CHOICE_FIELDS[key]) {
      const text = safeText(value, key) || "";
      if (!CHOICE_FIELDS[key].includes(text)) throw validationError(key + " 값이 올바르지 않습니다.");
      out[key] = text;
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
  let auditLogReady = false;
  if (serverCfg.ready) {
    try {
      const rows = await admin.rest("GET", "automation_runs", { query: "?select=job_name,status,finished_at,created_at,error_message&order=created_at.desc&limit=1" });
      latestAutomation = Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (error) {
      automationError = "automation_runs_unavailable";
    }
    try {
      await admin.rest("GET", ADMIN_AUDIT_TABLE, { query: "?select=id&limit=1" });
      auditLogReady = true;
    } catch (error) {
      auditLogReady = false;
    }
  }

  return {
    supabase: { serverReady: serverCfg.ready, publicReady: publicCfg.ready },
    firebase: { configured: env.firebaseDatabaseUrl || env.firebaseServiceAccount },
    githubActions: { automationLogReady: Boolean(latestAutomation), latest: latestAutomation, error: automationError },
    adminAudit: { table: ADMIN_AUDIT_TABLE, ready: auditLogReady },
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

function requestIpHash(req) {
  const raw = String(
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    ""
  );
  if (!raw) return "";
  return crypto.createHash("sha256").update("mz-admin-ip::" + raw).digest("hex").slice(0, 24);
}

function auditPayload(payload) {
  const clone = Object.assign({}, payload || {});
  ["code", "password", "token", "secret"].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(clone, key)) clone[key] = "[redacted]";
  });
  return clone;
}

async function writeAuditLog(req, action, resourceKey, rowId, payload) {
  try {
    if (!getServerConfig().ready) return;
    await admin.insertRow(ADMIN_AUDIT_TABLE, {
      action: action,
      resource_key: resourceKey,
      table_name: RESOURCES[resourceKey] ? RESOURCES[resourceKey].table : "",
      row_id: rowId ? String(rowId) : "",
      payload: auditPayload(payload),
      user_agent: String(req.headers["user-agent"] || "").slice(0, 300),
      ip_hash: requestIpHash(req)
    });
  } catch (error) {
    console.warn("[admin audit skipped]", error && error.message);
  }
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

  if (RETIRED_RESOURCES.has(resourceKey)) {
    return fail(res, 410, "resource_retired", "종료된 관리자 리소스입니다.");
  }

  if (resourceKey === "system-health" && method === "GET") {
    try {
      return ok(res, await systemHealth(req));
    } catch (e) {
      return handleError(res, e);
    }
  }

  if (resourceKey === "meta" && method === "GET") {
    return ok(res, adminMetadata());
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
      await writeAuditLog(req, "reorder", "links", "", { orders: orders });
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

  if (resourceKey === "audit" && method === "GET") {
    try {
      const data = await admin.rest("GET", ADMIN_AUDIT_TABLE, {
        query: "?select=action,resource_key,table_name,row_id,created_at,user_agent&order=created_at.desc&limit=40"
      });
      return ok(res, data);
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

    if (method === "GET" && id && !subAction) {
      const data = await admin.rest("GET", table, { query: "?select=*&id=eq." + encodeURIComponent(id) + "&limit=1" });
      return ok(res, Array.isArray(data) ? (data[0] || null) : data);
    }

    // POST /admin/<resource>
    if (method === "POST" && !id) {
      const body = await readJsonBody(req);
      const payload = normalizePayload(table, pickFields(table, body));
      if (!Object.keys(payload).length) return fail(res, 400, "empty_payload", "저장할 값이 없습니다.");
      requireFields(table, payload, true);
      const data = await admin.insertRow(table, payload);
      await writeAuditLog(req, "create", resourceKey, Array.isArray(data) && data[0] ? data[0].id : "", payload);
      return ok(res, data);
    }

    // PATCH /admin/<resource>/:id ...
    if (method === "PATCH" && id) {
      if (subAction === "hide") {
        const data = await admin.softDelete(table, id);
        await writeAuditLog(req, "hide", resourceKey, id, {});
        return ok(res, data);
      }
      if (subAction === "restore") {
        const data = await admin.restore(table, id);
        await writeAuditLog(req, "restore", resourceKey, id, {});
        return ok(res, data);
      }
      if (subAction === "pin") {
        const body = await readJsonBody(req);
        const pinned = body && typeof body.pinned === "boolean" ? body.pinned : true;
        const data = await admin.updateRow(table, id, { is_pinned: pinned });
        await writeAuditLog(req, "pin", resourceKey, id, { is_pinned: pinned });
        return ok(res, data);
      }
      // 일반 수정
      const body = await readJsonBody(req);
      const payload = normalizePayload(table, pickFields(table, body));
      if (!Object.keys(payload).length) return fail(res, 400, "empty_payload", "수정할 값이 없습니다.");
      requireFields(table, payload, false);
      const data = await admin.updateRow(table, id, payload);
      await writeAuditLog(req, "update", resourceKey, id, payload);
      return ok(res, data);
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
