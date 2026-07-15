const fs = require("fs");
const path = require("path");
const { ensureBucket, getR2Config, putJson, putObject } = require("../lib/r2/client");

function parseArgs(argv) {
  const args = { dryRun: false, envFiles: [], buckets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--dry-run") args.dryRun = true;
    else if (value === "--env-file" && argv[i + 1]) args.envFiles.push(argv[++i]);
    else if (value === "--buckets" && argv[i + 1]) {
      args.buckets = argv[++i].split(",").map((item) => item.trim()).filter(Boolean);
    } else if (value === "--skip-storage") args.skipStorage = true;
    else if (value === "--skip-tier-state") args.skipTierState = true;
  }
  if (!args.buckets.length) {
    args.buckets = ["tier-records", "video-thumbnails", "calmsv-assets"];
  }
  return args;
}

function loadEnvFile(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolute, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) return;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value.replace(/\\n/g, "\n");
  });
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) throw new Error("Supabase URL/service key missing");
  return { url, key };
}

function authHeaders(config, extra = {}) {
  return { apikey: config.key, Authorization: `Bearer ${config.key}`, ...extra };
}

function encodePath(value) {
  return String(value || "").split("/").map(encodeURIComponent).join("/");
}

async function listFolder(config, bucket, prefix, output, visited) {
  const visitKey = `${bucket}:${prefix}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  let offset = 0;
  const limit = 1000;
  while (true) {
    const response = await fetch(`${config.url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: authHeaders(config, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`list_${bucket}_${response.status}: ${text.slice(0, 200)}`);
    const rows = text ? JSON.parse(text) : [];
    for (const row of rows) {
      if (!row || !row.name || row.name === ".emptyFolderPlaceholder") continue;
      const objectPath = prefix ? `${prefix}/${row.name}` : row.name;
      const isFolder = !row.id && !row.metadata;
      if (isFolder) await listFolder(config, bucket, objectPath, output, visited);
      else {
        output.push({
          bucket,
          path: objectPath,
          bytes: Number((row.metadata && row.metadata.size) || 0),
          contentType: (row.metadata && row.metadata.mimetype) || "",
        });
      }
    }
    if (rows.length < limit) break;
    offset += limit;
  }
}

async function listBucket(config, bucket) {
  const output = [];
  await listFolder(config, bucket, "", output, new Set());
  return output;
}

async function readStorageObject(config, item) {
  const response = await fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(item.bucket)}/${encodePath(item.path)}`,
    { headers: authHeaders(config) }
  );
  if (!response.ok) throw new Error(`download_${item.bucket}_${response.status}: ${item.path}`);
  return Buffer.from(await response.arrayBuffer());
}

function contentType(item) {
  if (item.contentType) return item.contentType;
  const extension = path.extname(item.path).toLowerCase();
  return {
    ".json": "application/json; charset=utf-8",
    ".gz": "application/gzip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  }[extension] || "application/octet-stream";
}

function cacheControl(item) {
  if (/asset-manifest\.json$/i.test(item.path)) return "public, max-age=60";
  if (/\.(png|jpe?g|webp|gif|svg|mp3|wav)$/i.test(item.path)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=300";
}

function rewriteCalmsvManifest(item, body, publicBaseUrl) {
  if (item.bucket !== "calmsv-assets" || !/asset-manifest\.json$/i.test(item.path)) return body;
  if (!publicBaseUrl) return body;
  try {
    const manifest = JSON.parse(body.toString("utf8"));
    Object.values(manifest.assets || {}).forEach((asset) => {
      if (asset && asset.path) asset.publicUrl = `${publicBaseUrl}/calmsv-assets/${asset.path}`;
    });
    manifest.cdn = "cloudflare-r2";
    return Buffer.from(JSON.stringify(manifest, null, 2));
  } catch (error) {
    throw new Error(`invalid CALMSV manifest: ${error.message}`);
  }
}

async function readTierSnapshots(config) {
  const query = "?select=snapshot_key,payload,updated_at,source";
  const response = await fetch(`${config.url}/rest/v1/tier_state_snapshots${query}`, {
    headers: authHeaders(config),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`tier_state_${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

function buildTierObjects(rows) {
  const snapshots = Object.fromEntries((rows || []).map((row) => [row.snapshot_key, row]));
  const newest = (keys) => keys.map((key) => snapshots[key] && snapshots[key].updated_at)
    .filter(Boolean).sort().pop() || new Date().toISOString();
  return {
    "tier-state/core.json": {
      version: 1,
      source: "supabase-migration",
      updatedAt: newest(["meta", "players", "winRates"]),
      meta: (snapshots.meta && snapshots.meta.payload) || {},
      players: (snapshots.players && snapshots.players.payload) || [],
      winRates: (snapshots.winRates && snapshots.winRates.payload) || {},
    },
    "tier-state/live.json": {
      version: 1,
      source: "supabase-migration",
      updatedAt: newest(["liveStatus", "liveMeta"]),
      liveStatus: (snapshots.liveStatus && snapshots.liveStatus.payload) || {},
      liveMeta: (snapshots.liveMeta && snapshots.liveMeta.payload) || {},
    },
    "tier-state/record-meta.json": {
      version: 1,
      source: "supabase-migration",
      updatedAt: newest(["recordMeta"]),
      recordMeta: (snapshots.recordMeta && snapshots.recordMeta.payload) || {},
    },
  };
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function formatBytes(value) {
  return `${(Number(value || 0) / 1024 / 1024).toFixed(2)} MiB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.envFiles.forEach(loadEnvFile);
  const supabase = supabaseConfig();
  const r2 = getR2Config();

  const inventory = [];
  if (!args.skipStorage) {
    for (const bucket of args.buckets) {
      const items = await listBucket(supabase, bucket);
      const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
      inventory.push(...items);
      console.log(`[inventory] ${bucket}: ${items.length} objects, ${formatBytes(bytes)}`);
    }
  }

  let tierObjects = {};
  if (!args.skipTierState) {
    const rows = await readTierSnapshots(supabase);
    tierObjects = buildTierObjects(rows);
    for (const [key, value] of Object.entries(tierObjects)) {
      console.log(`[inventory] ${key}: ${formatBytes(Buffer.byteLength(JSON.stringify(value)))}`);
    }
  }

  if (args.dryRun) {
    console.log(`[dry-run] total storage: ${inventory.length} objects, ${formatBytes(inventory.reduce((sum, item) => sum + item.bytes, 0))}`);
    return;
  }
  if (!r2.ready) throw new Error("R2 credentials missing; set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET");

  await ensureBucket(r2);
  let uploadedBytes = 0;
  await mapLimit(inventory, 4, async (item, index) => {
    let body = await readStorageObject(supabase, item);
    body = rewriteCalmsvManifest(item, body, r2.publicBaseUrl);
    await putObject(`${item.bucket}/${item.path}`, body, {
      contentType: contentType(item),
      cacheControl: cacheControl(item),
    }, r2);
    uploadedBytes += body.length;
    if ((index + 1) % 25 === 0 || index + 1 === inventory.length) {
      console.log(`[upload] storage ${index + 1}/${inventory.length}`);
    }
  });

  for (const [key, value] of Object.entries(tierObjects)) {
    await putJson(key, value, { cacheControl: "public, max-age=60" }, r2);
    console.log(`[upload] ${key}`);
  }
  console.log(`[done] ${inventory.length + Object.keys(tierObjects).length} objects, ${formatBytes(uploadedBytes)}`);
}

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exitCode = 1;
});
