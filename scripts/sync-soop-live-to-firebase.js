const fs = require("fs/promises");
const path = require("path");
const admin = require("firebase-admin");
const { withAutomationLog } = require("./lib/automationLogger");
const { upsertTierStateSnapshots } = require("../lib/tier-state-snapshots");

const root = path.resolve(__dirname, "..");
const manualPlayersPath = path.join(root, "data", "manual", "players.json");

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app";

const FIREBASE_TIER_ROOT = process.env.FIREBASE_TIER_ROOT || "starcraftTier/current";

const SOOP_CLIENT_ID = process.env.SOOP_CLIENT_ID || "";

const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.FETCH_TIMEOUT_MS || 8000));
const SOOP_LIVE_MAX_PAGES = Math.max(1, Number(process.env.SOOP_LIVE_MAX_PAGES || 300));
const SOOP_LIVE_PAGE_BATCH = Math.max(1, Number(process.env.SOOP_LIVE_PAGE_BATCH || 3));
const TIER_STATE_SNAPSHOT_UPLOAD =
  process.env.TIER_STATE_SNAPSHOT_UPLOAD === "true" ||
  process.env.SUPABASE_TIER_STATE_UPLOAD === "true";
const TIER_STATE_SNAPSHOT_REQUIRED =
  process.env.TIER_STATE_SNAPSHOT_REQUIRED === "true" ||
  process.env.SUPABASE_TIER_STATE_REQUIRED === "true";
let lastSoopFetchStats = { pagesChecked: 0, failedPages: 0 };

function safeKey(value) {
  return String(value || "").replace(/[.#$/[\]]/g, "_");
}

function normalizeUrl(url) {
  if (!url) return "";
  const value = String(url);
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`${response.status} ${url}`);
    }

    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
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

async function fetchSoopBroadList(pageNo = 1) {
  if (!SOOP_CLIENT_ID) {
    throw new Error("SOOP_CLIENT_ID is missing");
  }

  const params = new URLSearchParams({
    client_id: SOOP_CLIENT_ID,
    page_no: String(pageNo),
  });

  return fetchWithTimeout(`https://openapi.sooplive.com/broad/list?${params}`, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });
}

async function loadPlayersFromFirebase(db) {
  const snapshot = await db.ref(`${FIREBASE_TIER_ROOT}/players`).get();
  const value = snapshot.val();

  if (!value) return [];

  const list = Array.isArray(value) ? value : Object.values(value);

  return list
    .filter((player) => player && player.userId)
    .map((player, index) => ({
      index,
      userId: String(player.userId),
      name: player.name || player.userId,
      race: player.race || "",
      tier: player.tier || "",
      tierCode: player.tierCode || "",
    }));
}

async function loadPlayersFromLocal() {
  const raw = await fs.readFile(manualPlayersPath, "utf8");
  const value = JSON.parse(raw);
  const list = Array.isArray(value) ? value : Object.values(value || {});

  return list
    .filter((player) => player && player.userId)
    .map((player, index) => ({
      index,
      userId: String(player.userId),
      name: player.name || player.userId,
      race: player.race || "",
      tier: player.tier || "",
      tierCode: player.tierCode || "",
    }));
}

async function loadPlayers(db) {
  try {
    const players = await loadPlayersFromLocal();
    if (players.length) {
      console.log(`[local] players loaded ${players.length}: data/manual/players.json`);
      return players;
    }
  } catch (error) {
    console.warn(`[local] manual players unavailable: ${error.message}`);
  }

  console.log("[firebase] fallback load players");
  return loadPlayersFromFirebase(db);
}

async function fetchSoopLiveMap(players) {
  lastSoopFetchStats = { pagesChecked: 0, failedPages: 0 };
  const targets = players
    .filter((player) => player && player.userId)
    .map((player) => String(player.userId));

  const displayNames = Object.fromEntries(
    players.map((player) => [String(player.userId), player.name || player.userId])
  );

  const remaining = new Set(targets);
  const liveMap = new Map();

  if (!remaining.size) return liveMap;

  console.log(`[soop] live check start targets=${remaining.size}`);

  let pagesChecked = 0;

  for (let startPage = 1; startPage <= SOOP_LIVE_MAX_PAGES; startPage += SOOP_LIVE_PAGE_BATCH) {
    const pageNumbers = [];

    for (let i = 0; i < SOOP_LIVE_PAGE_BATCH; i += 1) {
      const pageNo = startPage + i;
      if (pageNo <= SOOP_LIVE_MAX_PAGES) {
        pageNumbers.push(pageNo);
      }
    }

    const results = await Promise.all(
      pageNumbers.map((pageNo) =>
        fetchSoopBroadList(pageNo).catch((error) => {
          console.warn(`[soop] broad/list fail page=${pageNo}: ${error.message}`);
          return null;
        })
      )
    );

    lastSoopFetchStats.failedPages += results.filter((data) => !data).length;

    for (const data of results) {
      if (!data) continue;

      const broadList = Array.isArray(data.broad) ? data.broad : [];
      pagesChecked += 1;

      if (!broadList.length) continue;

      for (const item of broadList) {
        const id = String(item.user_id || "");
        if (!id || !remaining.has(id)) continue;

        const broadNo = String(item.broad_no || "");

        liveMap.set(id, {
          live: true,
          status: "live",
          userId: id,
          name: displayNames[id] || item.user_nick || id,
          userNick: item.user_nick || displayNames[id] || id,
          title: item.broad_title || "",
          broadNo,
          thumbnail: normalizeUrl(item.broad_thumb),
          startAt: item.broad_start || "",
          categoryTags: [],
          totalViewCount: Number(item.total_view_cnt || 0),
          profileImg: normalizeUrl(item.profile_img),
          stationUrl: `https://www.sooplive.com/station/${id}`,
          broadcastUrl: broadNo
            ? `https://play.sooplive.com/${id}/${broadNo}`
            : `https://play.sooplive.com/${id}`,
          checkedAt: new Date().toISOString(),
        });

        remaining.delete(id);
      }
    }

    if (remaining.size === 0) {
      break;
    }

    await sleep(80);
  }

  console.log(
    `[soop] live check done pages=${pagesChecked}, live=${liveMap.size}/${targets.length}`
  );
  lastSoopFetchStats.pagesChecked = pagesChecked;

  if (pagesChecked === 0) {
    throw new Error("SOOP broad/list returned no usable pages; keep previous Firebase live state");
  }

  return liveMap;
}

function buildLiveStatus(players, liveMap) {
  const checkedAt = new Date().toISOString();
  const liveStatus = {
    __meta: {
      checkedAt,
      playerCount: players.length,
      liveCount: liveMap.size,
      source: "soop-openapi-broad-list",
      mode: "live-only",
    },
  };

  players.forEach((player) => {
    const info = liveMap.get(String(player.userId));

    if (!info) return;

    liveStatus[safeKey(player.userId)] = {
      ...info,
      race: player.race || "",
      tier: player.tier || "",
      tierCode: player.tierCode || "",
      checkedAt,
    };
  });

  return liveStatus;
}

async function uploadTierLiveSnapshot(liveStatus, liveMeta) {
  const stats = {
    enabled: TIER_STATE_SNAPSHOT_UPLOAD,
    attempted: 0,
    succeeded: 0,
    failed: 0,
  };

  if (!TIER_STATE_SNAPSHOT_UPLOAD) {
    console.log("[supabase] tier live snapshot upload disabled");
    return stats;
  }

  try {
    const result = await upsertTierStateSnapshots(
      {
        liveStatus,
        liveMeta,
      },
      "sync-soop-live"
    );
    stats.attempted = result.attempted;
    stats.succeeded = result.succeeded;
    console.log(`[supabase] tier live snapshots upserted ${stats.succeeded}/${stats.attempted}`);
    return stats;
  } catch (error) {
    stats.failed = Math.max(stats.attempted, 1);
    console.warn(`[supabase] tier live snapshot upload failed: ${error.message}`);
    if (TIER_STATE_SNAPSHOT_REQUIRED) throw error;
    return stats;
  }
}

async function main(run = {}) {
  console.log("[config]", {
    FIREBASE_TIER_ROOT,
    FETCH_TIMEOUT_MS,
    SOOP_LIVE_MAX_PAGES,
    SOOP_LIVE_PAGE_BATCH,
    TIER_STATE_SNAPSHOT_UPLOAD,
    TIER_STATE_SNAPSHOT_REQUIRED,
  });

  const db = initFirebase();

  console.log("[players] load roster");
  const players = await loadPlayers(db);

  if (!players.length) {
    throw new Error(`${FIREBASE_TIER_ROOT}/players is empty`);
  }

  console.log(`[firebase] players loaded ${players.length}`);

  const liveMap = await fetchSoopLiveMap(players);
  const liveStatus = buildLiveStatus(players, liveMap);

  const checkedAt = new Date().toISOString();

  console.log("[firebase] update liveStatus");
  await db.ref(`${FIREBASE_TIER_ROOT}/liveStatus`).set(liveStatus);

  console.log("[firebase] update live meta");
  await db.ref(`${FIREBASE_TIER_ROOT}/meta/liveSyncedAt`).set(checkedAt);
  await db.ref(`${FIREBASE_TIER_ROOT}/meta/liveCount`).set(liveMap.size);
  await db.ref("starcraftTier/liveMeta").set({
    checkedAt,
    root: FIREBASE_TIER_ROOT,
    playerCount: players.length,
    liveCount: liveMap.size,
    source: "soop-openapi-broad-list",
  });

  const liveMeta = {
    liveSyncedAt: checkedAt,
    checkedAt,
    root: FIREBASE_TIER_ROOT,
    playerCount: players.length,
    liveCount: liveMap.size,
    source: "soop-openapi-broad-list",
  };
  const tierStateSnapshotStats = await uploadTierLiveSnapshot(liveStatus, liveMeta);

  run.status = "success";
  run.itemsFound = players.length;
  run.itemsWritten = Object.keys(liveStatus).length + 3 + tierStateSnapshotStats.succeeded;
  run.itemsSkipped = Math.max(0, players.length - liveMap.size);
  run.meta = {
    firebaseRoot: FIREBASE_TIER_ROOT,
    playerCount: players.length,
    liveCount: liveMap.size,
    checkedAt,
    pagesChecked: lastSoopFetchStats.pagesChecked,
    failedPages: lastSoopFetchStats.failedPages,
    tierStateSnapshotUploadSucceeded: tierStateSnapshotStats.succeeded,
    tierStateSnapshotUploadFailed: tierStateSnapshotStats.failed
  };

  console.log(
    JSON.stringify(
      {
        ok: true,
        playerCount: players.length,
        liveCount: liveMap.size,
        checkedAt,
      },
      null,
      2
    )
  );
}

withAutomationLog({
  jobName: "sync-soop-live",
  jobType: process.env.GITHUB_EVENT_NAME || "scheduled",
  source: "soop-openapi-broad-list",
  target: "firebase",
  meta: { firebaseRoot: FIREBASE_TIER_ROOT }
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
