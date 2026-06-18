const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function loadLocalEnv() {
  [".env.local", ".env"].forEach((fileName) => {
    const filePath = path.join(root, fileName);
    if (!fsSync.existsSync(filePath)) return;
    const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line) => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) return;
      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    });
  });
}

loadLocalEnv();

const { upsertTierStateSnapshots } = require("../lib/tier-state-snapshots");

const DEFAULT_PLAYERS_PATH = path.join(root, "data", "players.json");
const DEFAULT_META_PATH = path.join(root, "data", "meta.json");
const DEFAULT_RECORD_META_PATH = path.join(root, "data", "record-meta.json");
const DEFAULT_FIREBASE_URL =
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app";
const FIREBASE_DATABASE_URL = String(
  process.env.FIREBASE_DATABASE_URL || DEFAULT_FIREBASE_URL
).replace(/\/+$/, "");
const FIREBASE_TIER_ROOT = process.env.FIREBASE_TIER_ROOT || process.env.FIREBASE_ROOT || "starcraftTier/current";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    apply: args.includes("--apply"),
    localOnly: args.includes("--local-only"),
    playersPath: DEFAULT_PLAYERS_PATH,
    metaPath: DEFAULT_META_PATH,
    recordMetaPath: DEFAULT_RECORD_META_PATH,
  };
  args.forEach((arg, index) => {
    if (arg === "--players" && args[index + 1]) out.playersPath = path.resolve(args[index + 1]);
    if (arg === "--meta" && args[index + 1]) out.metaPath = path.resolve(args[index + 1]);
    if (arg === "--record-meta" && args[index + 1]) {
      out.recordMetaPath = path.resolve(args[index + 1]);
    }
  });
  return out;
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

function normalizePlayers(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.players)) return value.players;
  if (Array.isArray(value.data)) return value.data;
  return Object.values(value);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function fetchFirebaseJson(key) {
  const url =
    FIREBASE_DATABASE_URL +
    "/" +
    FIREBASE_TIER_ROOT.replace(/^\/+|\/+$/g, "") +
    "/" +
    encodeURIComponent(key) +
    ".json";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readFirebaseCompactState(localOnly) {
  const state = {
    liveStatus: {},
    winRates: {},
    recordMeta: {},
  };
  if (localOnly) return state;

  for (const key of ["liveStatus", "winRates", "recordMeta"]) {
    try {
      const value = await fetchFirebaseJson(key);
      state[key] = normalizeObject(value);
      console.log(`[firebase] ${key} loaded: ${Object.keys(state[key]).length}`);
    } catch (error) {
      console.warn(`[firebase] ${key} skipped: ${error.message}`);
    }
  }

  return state;
}

async function main() {
  const args = parseArgs();
  console.log(`\n=== tier state snapshot seed (${args.apply ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`players: ${args.playersPath}`);
  console.log(`firebase: ${args.localOnly ? "disabled" : `${FIREBASE_DATABASE_URL}/${FIREBASE_TIER_ROOT}`}`);

  const playersFile = await readJsonIfExists(args.playersPath, {});
  const players = normalizePlayers(playersFile);
  const metaFromPlayers = normalizeObject(playersFile.meta);
  const metaFromFile = normalizeObject(await readJsonIfExists(args.metaPath, {}));
  const localRecordMeta = normalizeObject(await readJsonIfExists(args.recordMetaPath, {}));
  const firebaseState = await readFirebaseCompactState(args.localOnly);

  const meta = Object.assign({}, metaFromFile, metaFromPlayers, {
    tierStateSnapshotSeededAt: new Date().toISOString(),
    tierStateSnapshotPlayerCount: players.length,
  });

  const snapshots = {
    meta,
    players,
    liveStatus: firebaseState.liveStatus,
    winRates: firebaseState.winRates,
    recordMeta: Object.keys(localRecordMeta).length ? localRecordMeta : firebaseState.recordMeta,
  };

  console.log(`players: ${players.length}`);
  console.log(`liveStatus: ${Object.keys(snapshots.liveStatus).length}`);
  console.log(`winRates: ${Object.keys(snapshots.winRates).length}`);
  console.log(`recordMeta: ${Object.keys(snapshots.recordMeta).length}`);

  if (!args.apply) {
    console.log("DRY-RUN: Supabase에는 쓰지 않았습니다. 적용하려면 --apply를 붙이세요.");
    return;
  }

  const result = await upsertTierStateSnapshots(snapshots, "seed-tier-state-snapshots");
  console.log(`완료: snapshot upsert ${result.succeeded}/${result.attempted}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
