(function () {
  const CACHE_PREFIX = "monstarz-data-cache:";
  const memoryCache = new Map();
  const inFlightRequests = new Map();
  const cachePolicies = new Map();
  const now = () => Date.now();

  const ttl = {
    live: 45 * 1000,
    notices: 3 * 60 * 1000,
    schedule: 3 * 60 * 1000,
    tier: 5 * 60 * 1000,
    records: 5 * 60 * 1000,
    videos: 15 * 60 * 1000,
    overrides: 2 * 60 * 1000,
    members: 30 * 60 * 1000,
    profile: 30 * 60 * 1000,
    history: 45 * 60 * 1000,
    links: 60 * 60 * 1000,
  };

  /**
   * Data shapes used by this static fanhub.
   * @typedef {{ name:string, userId?:string, race?:string, tier?:string|number, role?:string, status?:string, profileImage?:string, stream?:string, live?:string }} Member
   * @typedef {{ title:string, url?:string, link?:string, thumbnail?:string, publishedAt?:string, sourceName?:string }} VideoItem
   * @typedef {{ stationName?:string, userId?:string, title?:string, content?:string, time?:string, link?:string }} NoticeItem
   * @typedef {{ date:string, events:Array<{ name:string, race?:string, status:string }> }} InoutItem
   * @typedef {{ title:string, note?:string, url?:string, page?:string }} LinkItem
   * @typedef {{ data:any, loading:boolean, error:Error|null, isEmpty:boolean, updatedAt:string, stale?:boolean }} ServiceResult
   */

  function cacheKey(key) {
    return CACHE_PREFIX + key;
  }

  function isEmptyData(data) {
    if (data == null) return true;
    if (Array.isArray(data)) return data.length === 0;
    if (typeof data === "object") return Object.keys(data).length === 0;
    return false;
  }

  function normalizeResult(data, error, stale, updatedAt, source) {
    return {
      data,
      loading: false,
      error: error || null,
      isEmpty: isEmptyData(data),
      empty: isEmptyData(data),
      updatedAt: updatedAt || new Date().toISOString(),
      stale: Boolean(stale),
      source: source || (stale ? "cache" : "network"),
    };
  }

  function rememberPolicy(key, maxAge) {
    if (key && Number.isFinite(maxAge)) cachePolicies.set(key, maxAge);
  }

  function readStored(key) {
    try {
      const raw = localStorage.getItem(cacheKey(key));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStored(key, entry) {
    try {
      localStorage.setItem(cacheKey(key), JSON.stringify(entry));
    } catch (error) {
      // Private browsing or quota errors should never break the fanhub.
    }
  }

  function cacheSnapshot() {
    const rows = [];
    memoryCache.forEach((entry, key) => {
      const maxAge = cachePolicies.get(key) || 0;
      const ageMs = entry && entry.time ? now() - entry.time : 0;
      rows.push({
        key,
        updatedAt: entry && entry.updatedAt ? entry.updatedAt : "",
        ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
        ttlSeconds: Math.round(maxAge / 1000),
        stale: maxAge ? ageMs > maxAge : false,
      });
    });
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }

  function clearCache(match) {
    const needle = String(match || "");
    Array.from(memoryCache.keys()).forEach(key => {
      if (!needle || key.includes(needle)) memoryCache.delete(key);
    });
    try {
      Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
        .filter(key => key && key.indexOf(CACHE_PREFIX) === 0 && (!needle || key.includes(needle)))
        .forEach(key => localStorage.removeItem(key));
    } catch (error) {}
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort((a, b) => Number(a) - Number(b))
        .map(key => value[key])
        .filter(Boolean);
    }
    return [];
  }

  function toDateValue(value) {
    if (!value) return 0;
    if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    const raw = String(value).trim();
    if (!raw) return 0;
    const numeric = Number(raw);
    if (/^\d{10,13}$/.test(raw) && Number.isFinite(numeric)) return raw.length === 10 ? numeric * 1000 : numeric;
    const normalized = raw
      .replace(/\./g, "-")
      .replace(/^(\d{2})-(\d{2})-(\d{2})(.*)$/, (_, y, m, d, rest) => `20${y}-${m}-${d}${rest}`);
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sortLatest(items, fields) {
    const keys = fields || ["publishedAt", "published", "updatedAt", "createdAt", "time", "date"];
    return normalizeList(items).slice().sort((a, b) => {
      const at = Math.max(...keys.map(key => toDateValue(a && a[key])));
      const bt = Math.max(...keys.map(key => toDateValue(b && b[key])));
      return bt - at;
    });
  }

  function sortedHistory(items) {
    return normalizeList(items).slice().sort((a, b) => toDateValue(b.date) - toDateValue(a.date));
  }

  async function fetchJsonCached(key, url, maxAge, options) {
    const opts = options || {};
    rememberPolicy(key, maxAge);
    const cached = memoryCache.get(key) || readStored(key);
    const useCache = !opts.refresh && cached && now() - cached.time < maxAge;
    if (useCache) {
      memoryCache.set(key, cached);
      return normalizeResult(cached.data, null, false, cached.updatedAt, "cache");
    }
    if (!opts.refresh && inFlightRequests.has(key)) return inFlightRequests.get(key);

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = opts.timeoutMs || 0;
    const timeoutId = controller && timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const request = (async function () {
      try {
        const response = await fetch(url, {
          cache: opts.cache || "default",
          signal: controller ? controller.signal : undefined,
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        const entry = { time: now(), data, updatedAt: new Date().toISOString() };
        memoryCache.set(key, entry);
        writeStored(key, entry);
        return normalizeResult(data, null, false, entry.updatedAt, "network");
      } catch (error) {
        if (cached) return normalizeResult(cached.data, error, true, cached.updatedAt, "stale-cache");
        return normalizeResult(null, error, false, "", "error");
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        inFlightRequests.delete(key);
      }
    })();
    inFlightRequests.set(key, request);
    return request;
  }

  function fromStatic(key, data, maxAge) {
    rememberPolicy(key, maxAge);
    const cached = memoryCache.get(key);
    if (cached && now() - cached.time < maxAge) return normalizeResult(cached.data, null, false, cached.updatedAt, "memory");
    const entry = { time: now(), data, updatedAt: new Date().toISOString() };
    memoryCache.set(key, entry);
    return normalizeResult(data, null, false, entry.updatedAt, "static");
  }

  function getMembers(list) {
    const rows = normalizeList(list);
    return fromStatic("members:static", rows, ttl.members);
  }

  function getMemberById(list, id) {
    const userId = String(id || "");
    const rows = normalizeList(list);
    return fromStatic("members:static:" + userId, rows.find(item => item && String(item.userId || item.id || "") === userId) || null, ttl.members);
  }

  function getProfileMembers(list) {
    return fromStatic("profile:static", normalizeList(list), ttl.profile);
  }

  function getSchedules(list) {
    return fromStatic("schedule:static", sortLatest(list, ["date", "startAt", "startsAt"]), ttl.schedule);
  }

  function getScheduleToday(url, options) {
    return fetchJsonCached("schedule:today", url, ttl.schedule, options || {});
  }

  function getInoutList(list) {
    return fromStatic("inout:static", sortedHistory(list), ttl.history);
  }

  function getLinks(list) {
    return fromStatic("links:static", normalizeList(list), ttl.links);
  }

  function getVideos(list) {
    return fromStatic("videos:static", sortLatest(list, ["publishedAt", "published", "updatedAt", "createdAt"]), ttl.videos);
  }

  function stableUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw, window.location.href).href.replace(/#.*$/, "");
    } catch (error) {
      return raw.replace(/#.*$/, "");
    }
  }

  function getSoopVodId(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/(?:vod\.)?(?:sooplive|afreecatv)\.com\/player\/(\d+)/i) || raw.match(/(?:^|\/)player\/(\d+)(?:[/?#]|$)/i);
    return match ? match[1] : (/^\d+$/.test(raw) ? raw : "");
  }

  function isSoopVodUrl(value) {
    return Boolean(getSoopVodId(value));
  }

  function compactKey(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function hashKey(value) {
    const hash = String(value || "").trim().toLowerCase().replace(/^sha256:/, "");
    return hash ? "hash:" + hash : "";
  }

  const publicHashCache = new Map();
  async function publicHashValue(normalized) {
    if (!normalized) return "";
    if (publicHashCache.has(normalized)) return publicHashCache.get(normalized);
    let result = "";
    try {
      if (window.crypto && window.crypto.subtle && window.TextEncoder) {
        const bytes = new TextEncoder().encode(normalized);
        const digest = await window.crypto.subtle.digest("SHA-256", bytes);
        result = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
      }
    } catch (error) {
      result = "";
    }
    publicHashCache.set(normalized, result);
    return result;
  }

  async function publicValueHash(value) {
    return publicHashValue(stableUrl(value));
  }

  async function publicTextHash(value) {
    return publicHashValue(compactKey(value));
  }

  function noticeKeys(item) {
    const keys = [
      item && item.source_key,
      item && item.sourceKey,
      item && item.link,
      item && item.url,
      [item && (item.stationName || item.station_name || item.writer), item && item.title, item && (item.time || item.notice_date || item.date)].filter(Boolean).join("|")
    ];
    const hashes = [
      item && item.link_hash,
      item && item.linkHash,
      item && item.url_hash,
      item && item.urlHash,
      item && item.notice_hash,
      item && item.noticeHash
    ].map(hashKey);
    return keys.map(stableUrl).concat(keys.map(compactKey), hashes).filter(Boolean);
  }

  async function noticeKeysWithHashes(item) {
    const keys = noticeKeys(item);
    const linkHash = await publicValueHash(item && (item.link || item.url));
    if (linkHash) keys.push(hashKey(linkHash));
    const identity = item && [item.stationName || item.station_name || item.writer, item.title, item.time || item.notice_date || item.date].filter(Boolean).join("|");
    const noticeHash = await publicTextHash(identity);
    if (noticeHash) keys.push(hashKey(noticeHash));
    return keys;
  }

  function videoKeys(item) {
    const keys = [
      item && item.url,
      item && item.link
    ];
    const hashes = [
      item && item.url_hash,
      item && item.urlHash,
      item && item.link_hash,
      item && item.linkHash
    ].map(hashKey);
    return keys.map(stableUrl).concat(keys.map(compactKey), hashes).filter(Boolean);
  }

  async function videoKeysWithHashes(item) {
    const keys = videoKeys(item);
    const urlHash = await publicValueHash(item && (item.url || item.link));
    if (urlHash) keys.push(hashKey(urlHash));
    return keys;
  }

  async function getPublicOverrides(options) {
    return fetchJsonCached(
      "supabase:public-overrides",
      "/api/public-overrides",
      ttl.overrides,
      options || {}
    );
  }

  function normalizeSoopVodMetaPayload(data) {
    const payload = data && data.data && typeof data.data === "object" ? data.data : data;
    if (!payload || typeof payload !== "object") return {};
    return {
      title: payload.title || "",
      thumbnail: payload.thumbnail || payload.thumbnail_url || payload.thumbnailUrl || "",
      html: payload.html || payload.embed_html || payload.embedHtml || ""
    };
  }

  async function enrichSoopVideoRows(rows, options) {
    return Promise.all(normalizeList(rows).map(async row => {
      if (!row || row.thumbnail || !isSoopVodUrl(row.url || row.link)) return row;
      const result = await soopVodMeta(row.url || row.link, options);
      const meta = normalizeSoopVodMetaPayload(result && result.data);
      if (!meta.thumbnail && !meta.title) return row;
      return {
        ...row,
        title: row.title || meta.title || "",
        thumbnail: row.thumbnail || meta.thumbnail || ""
      };
    }));
  }

  async function mergeNoticeMeta(items, options) {
    const base = normalizeList(items);
    const result = await getPublicOverrides(options);
    const rows = normalizeList(result && result.data && result.data.noticesMeta);
    if (!rows.length) return base;

    const metaByKey = new Map();
    await Promise.all(rows.map(async row => {
      const keys = await noticeKeysWithHashes(row);
      keys.forEach(key => metaByKey.set(key, row));
    }));

    const merged = await Promise.all(base.map(async (item, index) => {
        const keys = await noticeKeysWithHashes(item);
        const meta = keys.map(key => metaByKey.get(key)).find(Boolean);
        if (meta && meta.is_visible === false) return null;
        return {
          ...item,
          _order: item._order == null ? index : item._order,
          title: meta && meta.title ? meta.title : item.title,
          stationName: meta && meta.station_name ? meta.station_name : item.stationName,
          link: meta && meta.link ? meta.link : item.link,
          time: meta && meta.notice_date ? meta.notice_date : item.time,
          isPinned: Boolean(meta && meta.is_pinned),
          sortOrder: meta ? Number(meta.sort_order || 0) : Number(item.sortOrder || 0)
        };
      }));

    return merged
      .filter(Boolean)
      .sort((a, b) => {
        const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        if (pinDiff) return pinDiff;
        const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        if (sortDiff) return sortDiff;
        return Number(a._order || 0) - Number(b._order || 0);
      });
  }

  async function mergeVideoMeta(items, options) {
    const base = normalizeList(items);
    const result = await getPublicOverrides(options);
    let rows = normalizeList(result && result.data && result.data.videos);
    if (!rows.length) return base;
    rows = await enrichSoopVideoRows(rows, options);

    const hiddenKeys = new Set();
    const metaByKey = new Map();
    await Promise.all(rows.map(async row => {
      if (!row) return;
      const keys = await videoKeysWithHashes(row);
      if (row.is_visible === false) keys.forEach(key => hiddenKeys.add(key));
      else keys.forEach(key => metaByKey.set(key, row));
    }));

    const merged = (await Promise.all(base.map(async (item, index) => {
        const keys = await videoKeysWithHashes(item);
        if (keys.some(key => hiddenKeys.has(key))) return null;
        const meta = keys.map(key => metaByKey.get(key)).find(Boolean);
        return {
          ...item,
          _order: item._order == null ? index : item._order,
          title: meta && meta.title ? meta.title : item.title,
          url: meta && meta.url ? meta.url : item.url,
          link: meta && meta.url ? meta.url : (item.link || item.url),
          thumbnail: meta && meta.thumbnail ? meta.thumbnail : item.thumbnail,
          thumb: meta && meta.thumbnail ? meta.thumbnail : (item.thumb || item.thumbnail),
          sourceName: meta && meta.platform ? meta.platform : item.sourceName,
          platform: meta && meta.platform ? meta.platform : item.platform,
          memberCode: meta && meta.member_code ? meta.member_code : item.memberCode,
          publishedAt: meta && meta.published_at ? meta.published_at : item.publishedAt,
          isPinned: Boolean(meta && meta.is_pinned),
          sortOrder: meta ? Number(meta.sort_order || 0) : Number(item.sortOrder || 0)
        };
      }))).filter(Boolean);

    const seenUrls = new Set(merged.map(item => stableUrl(item.url || item.link)).filter(Boolean));
    rows
      .filter(row => row && row.is_visible !== false && row.url && !seenUrls.has(stableUrl(row.url)))
      .forEach((row, index) => {
        const url = stableUrl(row.url);
        seenUrls.add(url);
        merged.push({
          _order: 100000 + index,
          title: row.title || "영상",
          url: row.url,
          link: row.url,
          thumbnail: row.thumbnail || "",
          thumb: row.thumbnail || "",
          sourceName: row.platform || "수동 등록",
          platform: row.platform || "수동 등록",
          memberCode: row.member_code || "",
          publishedAt: row.published_at || row.updated_at || "",
          isPinned: row.is_pinned === true,
          sortOrder: Number(row.sort_order || 0)
        });
      });

    return merged.sort((a, b) => {
      const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      if (pinDiff) return pinDiff;
      const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
      if (sortDiff) return sortDiff;
      const timeDiff = toDateValue(b.publishedAt || b.published || b.updatedAt) - toDateValue(a.publishedAt || a.published || a.updatedAt);
      if (timeDiff) return timeDiff;
      return Number(a._order || 0) - Number(b._order || 0);
    });
  }

  function normalizeRecordPayload(value) {
    if (value && typeof value === "object") {
      if (Array.isArray(value.data)) return value.data;
      if (Array.isArray(value.records)) return value.records;
      if (Array.isArray(value.rows)) return value.rows;
      if (Array.isArray(value.list)) return value.list;
    }
    return normalizeList(value);
  }

  async function getRecords(rootUrl, userId, race, options) {
    const safeKey = String((userId || "") + "_" + (race || "")).replace(/[.#$/[\]]/g, "_");
    const opts = { cache: "no-store", ...(options || {}) };
    const storageResult = await fetchJsonCached(
      "records:storage:" + safeKey,
      "/api/tier-records?key=" + encodeURIComponent(safeKey),
      ttl.records,
      opts
    );

    if (
      storageResult.data !== null &&
      storageResult.data !== undefined &&
      (!storageResult.error || storageResult.stale)
    ) {
      return normalizeResult(
        normalizeRecordPayload(storageResult.data),
        storageResult.stale ? storageResult.error : null,
        storageResult.stale,
        storageResult.updatedAt,
        storageResult.source === "network" ? "supabase-storage" : storageResult.source
      );
    }

    const firebaseResult = await fetchJsonCached(
      "records:firebase:" + safeKey,
      rootUrl.replace(/\/$/, "") + "/records/" + encodeURIComponent(safeKey) + ".json",
      ttl.records,
      opts
    );

    return normalizeResult(
      normalizeRecordPayload(firebaseResult.data),
      firebaseResult.error || storageResult.error,
      firebaseResult.stale,
      firebaseResult.updatedAt || storageResult.updatedAt,
      firebaseResult.source === "network" ? "firebase-fallback" : firebaseResult.source
    );
  }

  async function soopOembed(vodUrl, options) {
    const opts = options || {};
    const width = opts.width || 960;
    const height = opts.height || 540;
    const url = "https://openapi.sooplive.com/oembed/embedinfo?vod_url=" +
      encodeURIComponent(vodUrl) + "&width=" + encodeURIComponent(width) + "&height=" + encodeURIComponent(height);
    return fetchJsonCached("soop-oembed:" + vodUrl + ":" + width + "x" + height, url, ttl.videos, opts);
  }

  async function soopVodMeta(vodUrl, options) {
    const opts = options || {};
    const width = opts.width || 960;
    const height = opts.height || 540;
    const vodId = getSoopVodId(vodUrl);
    if (!vodId) return normalizeResult(null, new Error("invalid_soop_vod_url"), false, "", "error");
    const url = "/api/soop-vod-meta?url=" +
      encodeURIComponent("https://vod.sooplive.com/player/" + vodId) +
      "&width=" + encodeURIComponent(width) +
      "&height=" + encodeURIComponent(height);
    return fetchJsonCached("soop-vod-meta:" + vodId + ":" + width + "x" + height, url, ttl.videos, opts);
  }

  // ===== Phase 4: admin write functions (NOT implemented yet) =====
  // 인증/권한 분리 후 다음 패치에서 연결한다. 현재 관리자 UI는 읽기 전용이며
  // 아래 함수들은 placeholder 단계로만 둔다 (실제 DB 쓰기 금지).
  // TODO: admin createMember
  // TODO: admin updateMember
  // TODO: admin hideMember
  // TODO: admin createSchedule
  // TODO: admin updateSchedule
  // TODO: admin deleteSchedule
  // TODO: admin registerVideo
  // TODO: admin hideVideo
  // TODO: admin hideNotice
  // TODO: admin pinNotice
  // TODO: admin createInout
  // TODO: admin updateInout
  // TODO: admin updateLink
  // TODO: admin updateLinks

  window.MonstarzDataServices = {
    ttl,
    normalizeResult,
    normalizeList,
    sortLatest,
    fetchJsonCached,
    cacheSnapshot,
    getCacheSnapshot: cacheSnapshot,
    clearCache,
    members: getMembers,
    getMembers,
    getMemberById,
    profile: getProfileMembers,
    getProfileMembers,
    schedule: getSchedules,
    getSchedules,
    scheduleToday: getScheduleToday,
    getScheduleToday,
    history: getInoutList,
    inout: getInoutList,
    getInoutList,
    links: getLinks,
    getLinks,
    getVideos,
    videos: (key, url, options) => fetchJsonCached("videos:" + key, url, ttl.videos, options),
    notices: (url, options) => fetchJsonCached("notices", url, ttl.notices, options),
    publicOverrides: getPublicOverrides,
    getPublicOverrides,
    mergeNoticeMeta,
    mergeVideoMeta,
    live: (url, options) => fetchJsonCached("live", url, ttl.live, { cache: "no-store", ...(options || {}) }),
    tier: (key, url, options) => fetchJsonCached("tier:" + key, url, ttl.tier, options),
    records: getRecords,
    soopOembed,
    soopVodMeta,
  };
})();
