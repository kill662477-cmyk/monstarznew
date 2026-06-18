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

const { downloadGzJson, DEFAULT_BUCKET } = require("../lib/supabase/storage");
const supabaseAdmin = require("../lib/supabase/admin");
const {
  safeRecordKey,
  normalizeRows,
  playerRecordKey,
  buildHeadToHeadSummaries,
  summaryToDbRow,
} = require("../lib/tier-head-to-head-summary");

const DEFAULT_PLAYERS_PATH = path.join(root, "data", "manual", "players.json");
const TIER_RECORD_STORAGE_BUCKET = process.env.TIER_RECORD_STORAGE_BUCKET || DEFAULT_BUCKET;
const TIER_RECORD_STORAGE_PREFIX = normalizeStoragePrefix(
  process.env.TIER_RECORD_STORAGE_PREFIX || "records"
);

function normalizeStoragePrefix(value) {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function tierRecordStoragePath(key) {
  const fileName = `${safeRecordKey(key)}.json.gz`;
  return TIER_RECORD_STORAGE_PREFIX ? `${TIER_RECORD_STORAGE_PREFIX}/${fileName}` : fileName;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    apply: args.includes("--apply"),
    playersPath: process.env.MANUAL_PLAYERS_PATH || DEFAULT_PLAYERS_PATH,
    concurrency: Math.max(1, Number(process.env.SEED_H2H_CONCURRENCY || 8)),
    chunkSize: Math.max(1, Number(process.env.SEED_H2H_CHUNK_SIZE || 500)),
  };
  args.forEach((arg, index) => {
    if (arg === "--players" && args[index + 1]) out.playersPath = path.resolve(args[index + 1]);
    if (arg === "--concurrency" && args[index + 1]) out.concurrency = Math.max(1, Number(args[index + 1]));
    if (arg === "--chunk-size" && args[index + 1]) out.chunkSize = Math.max(1, Number(args[index + 1]));
  });
  return out;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function readPlayers(playersPath) {
  const raw = await fs.readFile(playersPath, "utf8");
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : parsed.players || [])
    .filter((player) => player && player.userId && player.race && player.name)
    .map((player) => ({
      ...player,
      race: String(player.race || "").trim().toUpperCase(),
    }));
}

async function readStorageRecords(players, concurrency) {
  const recordsByKey = {};
  let ok = 0;
  let empty = 0;
  let fail = 0;

  await mapLimit(players, concurrency, async (player, index) => {
    const key = playerRecordKey(player);
    try {
      const value = await downloadGzJson(TIER_RECORD_STORAGE_BUCKET, tierRecordStoragePath(key));
      const rows = normalizeRows(value);
      if (rows.length) {
        recordsByKey[key] = rows;
        ok += 1;
      } else {
        empty += 1;
      }
    } catch (error) {
      fail += 1;
      console.warn(`[storage] ${key} read failed: ${error.message}`);
    }

    if ((index + 1) % 25 === 0 || index + 1 === players.length) {
      console.log(`[storage] records loaded ${index + 1}/${players.length}`);
    }
  });

  return { recordsByKey, ok, empty, fail };
}

async function upsertRows(rows, chunkSize) {
  let ok = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await supabaseAdmin.rest("POST", "tier_head_to_head_summaries", {
      query: "?on_conflict=pair_key",
      body: chunk,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    ok += chunk.length;
    console.log(`[supabase] h2h rows upserted ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
  }
  return ok;
}

async function main() {
  const args = parseArgs();
  console.log(`\n=== tier h2h summary seed (${args.apply ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`players: ${args.playersPath}`);
  console.log(`bucket: ${TIER_RECORD_STORAGE_BUCKET}/${TIER_RECORD_STORAGE_PREFIX || "."}`);

  const players = await readPlayers(args.playersPath);
  console.log(`source players: ${players.length}`);

  const storage = await readStorageRecords(players, args.concurrency);
  console.log(
    `[storage] ok=${storage.ok}, empty=${storage.empty}, fail=${storage.fail}, loadedKeys=${Object.keys(storage.recordsByKey).length}`
  );

  const summaries = buildHeadToHeadSummaries(players, storage.recordsByKey);
  const updatedAt = new Date().toISOString();
  const rows = summaries.map((summary) => ({
    ...summaryToDbRow(summary, updatedAt),
    source: "seed-tier-head-to-head-summaries",
  }));

  console.log(`summary rows: ${rows.length}`);
  rows.slice(0, 5).forEach((row, index) => {
    console.log(
      `  [${index + 1}] ${row.player_a_name}(${row.player_a_race}) vs ${row.player_b_name}(${row.player_b_race}) all=${row.all_wins}-${row.all_losses}`
    );
  });

  if (!args.apply) {
    console.log("DRY-RUN: DB에는 쓰지 않았습니다. 적용하려면 --apply를 붙이세요.");
    return;
  }

  const ok = await upsertRows(rows, args.chunkSize);
  console.log(`완료: upsert ${ok}/${rows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
