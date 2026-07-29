const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const manualPath = path.join(rootDir, "data", "manual", "players.json");
const cachePath = path.join(rootDir, "data", "players.json");
const tierboardPath = path.join(rootDir, "tierboard_calm_tab.html");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function localAsset(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath.replaceAll("/", path.sep)));
}

function normalizeAcademy(academy) {
  if (!academy || typeof academy !== "object") return null;

  const sourceImage = academy.sourceImage || academy.image || "";
  const localImage = academy.id ? `assets/academy/${academy.id}.jpg` : "";

  return {
    ...academy,
    image: localImage && localAsset(localImage) ? localImage : sourceImage,
    ...(sourceImage ? { sourceImage } : {}),
  };
}

function normalizePlayer(player, cachedPlayer) {
  const sourceImage = player.sourceImage || player.image || cachedPlayer?.sourceImage || "";
  const localImage = player.userId ? `assets/profile/${player.userId}.jpg` : "";

  return {
    ...(cachedPlayer || {}),
    ...player,
    image: localImage && localAsset(localImage) ? localImage : sourceImage,
    ...(sourceImage ? { sourceImage } : {}),
    academy: normalizeAcademy(player.academy),
    live: Boolean(cachedPlayer?.live),
    broad: cachedPlayer?.broad || null,
    broadcastUrl: cachedPlayer?.broadcastUrl || "",
  };
}

function syncCache(manualPlayers) {
  const cachePayload = readJson(cachePath);
  const cachedPlayers = Array.isArray(cachePayload) ? cachePayload : cachePayload.players || [];
  const cachedByUserId = new Map(cachedPlayers.map((player) => [player.userId, player]));
  const manualByUserId = new Map(manualPlayers.map((player) => [player.userId, player]));
  const orderedManualPlayers = [];
  const includedUserIds = new Set();

  for (const cachedPlayer of cachedPlayers) {
    const manualPlayer = manualByUserId.get(cachedPlayer.userId);
    if (!manualPlayer) continue;
    orderedManualPlayers.push(manualPlayer);
    includedUserIds.add(manualPlayer.userId);
  }

  for (const manualPlayer of manualPlayers) {
    if (includedUserIds.has(manualPlayer.userId)) continue;
    orderedManualPlayers.push(manualPlayer);
  }

  const players = orderedManualPlayers.map((player) =>
    normalizePlayer(player, cachedByUserId.get(player.userId))
  );

  const payload = Array.isArray(cachePayload)
    ? players
    : {
        ...cachePayload,
        meta: {
          ...(cachePayload.meta || {}),
          playerCount: players.length,
          sourcePlayerCount: manualPlayers.length,
        },
        players,
      };

  fs.writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return players;
}

function tierboardClassName(race) {
  const raceName = {
    T: "terran",
    Z: "zerg",
    P: "protoss",
  }[race] || "unknown";
  return `race-${raceName} animation starcraft-player-card`;
}

function tierboardPlayer(player) {
  return {
    academy: player.academy
      ? {
          image: player.academy.sourceImage || player.academy.image || "",
          name: player.academy.name,
        }
      : null,
    className: tierboardClassName(player.race),
    elo: player.elo || "",
    image: player.sourceImage || player.image || "",
    live: Boolean(player.live),
    name: player.name,
    race: player.race,
    station: player.station || "",
    tier: player.tier,
    tierId: player.tierId,
    winRate: player.winRate || "",
  };
}

function syncTierboard(players) {
  const html = fs.readFileSync(tierboardPath, "utf8");
  const pattern =
    /(<script id="tier-data" type="application\/json">)[\s\S]*?(<\/script>)/;
  const match = html.match(pattern);

  if (!match) {
    throw new Error("tier-data script block not found");
  }

  const embeddedPlayers = JSON.parse(
    match[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "")
  );
  const playerByStation = new Map(players.map((player) => [player.station, player]));
  const orderedPlayers = [];
  const includedStations = new Set();

  for (const embeddedPlayer of embeddedPlayers) {
    const player = playerByStation.get(embeddedPlayer.station);
    if (!player) continue;
    orderedPlayers.push(player);
    includedStations.add(player.station);
  }

  for (const player of players) {
    if (includedStations.has(player.station)) continue;
    orderedPlayers.push(player);
  }

  const nextHtml = html.replace(
    pattern,
    `$1${JSON.stringify(orderedPlayers.map(tierboardPlayer), null, 2)}$2`
  );
  fs.writeFileSync(tierboardPath, nextHtml, "utf8");
}

function main() {
  const manualPlayers = readJson(manualPath);

  if (!Array.isArray(manualPlayers) || !manualPlayers.length) {
    throw new Error("data/manual/players.json must contain a non-empty array");
  }

  const userIds = new Set();
  const names = new Set();
  for (const player of manualPlayers) {
    if (!player.userId) throw new Error(`missing userId: ${player.name || "(unknown)"}`);
    if (userIds.has(player.userId)) throw new Error(`duplicate userId: ${player.userId}`);
    if (names.has(player.name)) throw new Error(`duplicate name: ${player.name}`);
    userIds.add(player.userId);
    names.add(player.name);
  }

  const players = syncCache(manualPlayers);
  syncTierboard(players);
  console.log(`synced ${players.length} players: manual -> cache -> tierboard`);
}

main();
