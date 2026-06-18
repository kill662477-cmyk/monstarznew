const PERIOD_KEYS = ["m1", "m3", "y2026", "all"];

function safeRecordKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function safePairKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 260);
}

function normalizeRows(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === "object");
  if (typeof value === "object") {
    return Object.keys(value)
      .sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      })
      .map((key) => value[key])
      .filter((row) => row && typeof row === "object");
  }
  return [];
}

function playerUserId(player) {
  return String(
    (player && (player.userId || player.soopUserId || player.id || player.name)) || ""
  ).trim();
}

function playerRace(player) {
  return String((player && player.race) || "").trim().toUpperCase();
}

function playerName(player) {
  return String((player && player.name) || "").trim();
}

function playerRecordKey(player) {
  return safeRecordKey([playerUserId(player), playerRace(player)].join("_"));
}

function pairKeyForPlayers(playerA, playerB) {
  return safePairKey([playerRecordKey(playerA), playerRecordKey(playerB)].join("__"));
}

function emptyPeriodStats() {
  return {
    m1: { total: 0, wins: 0, losses: 0, rate: 0 },
    m3: { total: 0, wins: 0, losses: 0, rate: 0 },
    y2026: { total: 0, wins: 0, losses: 0, rate: 0 },
    all: { total: 0, wins: 0, losses: 0, rate: 0 },
  };
}

function finalizePeriods(periods) {
  PERIOD_KEYS.forEach((period) => {
    const stat = periods[period] || { total: 0, wins: 0, losses: 0 };
    stat.total = Math.max(0, Number(stat.total || 0));
    stat.wins = Math.max(0, Number(stat.wins || 0));
    stat.losses = Math.max(0, Number(stat.losses || 0));
    stat.rate = stat.total ? (stat.wins / stat.total) * 100 : 0;
    periods[period] = stat;
  });
  return periods;
}

function rowDate(row) {
  return String(row.date || row.standardDate || row.playedAt || row.createdAt || "").slice(0, 10);
}

function rowTime(row) {
  const date = rowDate(row).replace(/[./]/g, "-");
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return 0;
  const time = new Date(date.slice(0, 10) + "T00:00:00+09:00").getTime();
  return Number.isFinite(time) ? time : 0;
}

function inPeriod(row, period) {
  if (period === "all") return true;
  const date = rowDate(row).replace(/\./g, "-");
  if (period === "y2026") return date.startsWith("2026-");
  const time = rowTime(row);
  if (!time) return false;
  const days = period === "m1" ? 30 : 90;
  return time >= Date.now() - days * 86400000;
}

function ids(row) {
  return [
    row.winnerSoopUserId,
    row.winnerUserId,
    row.winnerId,
    row.winner,
    row.winSoopUserId,
    row.winUserId,
    row.loseSoopUserId,
    row.loserSoopUserId,
    row.loseUserId,
    row.loserUserId,
    row.loserId,
    row.loseId,
    row.loser,
    row.playerSoopUserId,
    row.playerUserId,
    row.playerId,
    row.opponentSoopUserId,
    row.opponentUserId,
    row.opponentId,
  ].map((value) => String(value || "")).filter(Boolean);
}

function names(row) {
  return [
    row.winnerPlayer,
    row.winnerName,
    row.winPlayer,
    row.winName,
    row.losePlayer,
    row.loserPlayer,
    row.loseName,
    row.loserName,
    row.playerName,
    row.bjName,
    row.targetName,
    row.opponentName,
    row.opponentPlayer,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function playerRef(player) {
  return { userId: playerUserId(player), name: playerName(player) };
}

function rowContainsPlayer(row, player) {
  const ref = playerRef(player);
  if (ref.userId && ids(row).includes(ref.userId)) return true;
  return Boolean(ref.name && names(row).includes(ref.name));
}

function winnerId(row) {
  return String(row.winnerSoopUserId || row.winnerUserId || row.winnerId || row.winner || row.winSoopUserId || row.winUserId || "");
}

function loserId(row) {
  return String(row.loseSoopUserId || row.loserSoopUserId || row.loseUserId || row.loserUserId || row.loserId || row.loseId || row.loser || "");
}

function winnerName(row) {
  return String(row.winnerPlayer || row.winnerName || row.winPlayer || row.winName || "").trim();
}

function loserName(row) {
  return String(row.losePlayer || row.loserPlayer || row.loseName || row.loserName || "").trim();
}

function winnerRace(row) {
  return String(row.winnerRace || row.winRace || "").trim().toUpperCase();
}

function loserRace(row) {
  return String(row.loseRace || row.loserRace || "").trim().toUpperCase();
}

function rowWinnerMatches(row, player) {
  const ref = playerRef(player);
  if (ref.userId && winnerId(row) === ref.userId) return true;
  return Boolean(ref.name && winnerName(row) === ref.name);
}

function rowLoserMatches(row, player) {
  const ref = playerRef(player);
  if (ref.userId && loserId(row) === ref.userId) return true;
  return Boolean(ref.name && loserName(row) === ref.name);
}

function rowIsWin(row, player) {
  if (winnerId(row) || winnerName(row)) return rowWinnerMatches(row, player);
  return String(row.result || row.win || "").toLowerCase() === "win" || row.isWin === true;
}

function rowOpponentId(row, player) {
  if (rowWinnerMatches(row, player)) return loserId(row);
  if (rowLoserMatches(row, player)) return winnerId(row);
  return String(row.opponentSoopUserId || row.opponentUserId || row.opponentId || "");
}

function rowOpponentName(row, player) {
  if (rowWinnerMatches(row, player)) return loserName(row) || row.opponentName || row.opponentPlayer || "";
  if (rowLoserMatches(row, player)) return winnerName(row) || row.opponentName || row.opponentPlayer || "";
  return row.opponentName || row.opponentPlayer || "";
}

function rowOpponentRace(row, player) {
  if (rowWinnerMatches(row, player)) return loserRace(row) || row.opponentRace || "";
  if (rowLoserMatches(row, player)) return winnerRace(row) || row.opponentRace || "";
  return String(row.opponentRace || "").trim().toUpperCase();
}

function pairRowId(row) {
  return [
    rowDate(row),
    winnerId(row) || winnerName(row),
    loserId(row) || loserName(row),
    row.map || row.mapName || "",
  ].join("|");
}

function summarizePair(rowsA, rowsB, playerA, playerB) {
  const periods = emptyPeriodStats();
  const seen = new Set();

  function add(row, owner, opponent, invert) {
    if (!rowContainsPlayer(row, owner) || !rowContainsPlayer(row, opponent)) return;
    const id = pairRowId(row);
    if (seen.has(id)) return;
    seen.add(id);
    const ownerWin = rowIsWin(row, owner);
    const aWin = invert ? !ownerWin : ownerWin;
    PERIOD_KEYS.forEach((period) => {
      if (!inPeriod(row, period)) return;
      periods[period].total += 1;
      if (aWin) periods[period].wins += 1;
      else periods[period].losses += 1;
    });
  }

  normalizeRows(rowsA).forEach((row) => add(row, playerA, playerB, false));
  normalizeRows(rowsB).forEach((row) => add(row, playerB, playerA, true));
  return finalizePeriods(periods);
}

function buildPlayerIndexes(players) {
  const byUserRace = new Map();
  const byUser = new Map();
  const byNameRace = new Map();
  const byName = new Map();

  function add(map, key, player) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(player);
  }

  (players || []).forEach((player) => {
    const id = playerUserId(player);
    const race = playerRace(player);
    const name = playerName(player);
    add(byUserRace, id && race ? `${id}_${race}` : "", player);
    add(byUser, id, player);
    add(byNameRace, name && race ? `${name}_${race}` : "", player);
    add(byName, name, player);
  });

  return { byUserRace, byUser, byNameRace, byName };
}

function firstUnique(list) {
  return Array.isArray(list) && list.length === 1 ? list[0] : null;
}

function findOpponent(row, player, indexes) {
  const opponentId = rowOpponentId(row, player);
  const opponentRace = rowOpponentRace(row, player);
  const opponentName = String(rowOpponentName(row, player) || "").trim();

  if (opponentId && opponentRace) {
    const exact = firstUnique(indexes.byUserRace.get(`${opponentId}_${opponentRace}`));
    if (exact) return exact;
  }

  if (opponentId) {
    const byUser = firstUnique(indexes.byUser.get(opponentId));
    if (byUser) return byUser;
  }

  if (opponentName && opponentRace) {
    const byNameRace = firstUnique(indexes.byNameRace.get(`${opponentName}_${opponentRace}`));
    if (byNameRace) return byNameRace;
  }

  if (opponentName) {
    const byName = firstUnique(indexes.byName.get(opponentName));
    if (byName) return byName;
  }

  return null;
}

function ensurePair(summaryMap, playerA, playerB) {
  const pairKey = pairKeyForPlayers(playerA, playerB);
  if (!pairKey) return null;
  if (!summaryMap.has(pairKey)) {
    summaryMap.set(pairKey, {
      pairKey,
      playerA,
      playerB,
      periods: emptyPeriodStats(),
      seen: new Set(),
    });
  }
  return summaryMap.get(pairKey);
}

function addDirected(summaryMap, playerA, playerB, row, aWin) {
  const item = ensurePair(summaryMap, playerA, playerB);
  if (!item) return;
  const seenId = pairRowId(row);
  if (item.seen.has(seenId)) return;
  item.seen.add(seenId);
  PERIOD_KEYS.forEach((period) => {
    if (!inPeriod(row, period)) return;
    item.periods[period].total += 1;
    if (aWin) item.periods[period].wins += 1;
    else item.periods[period].losses += 1;
  });
}

function buildHeadToHeadSummaries(players, recordsByKey) {
  const summaries = new Map();
  const indexes = buildPlayerIndexes(players);

  (players || []).forEach((player) => {
    const key = playerRecordKey(player);
    const rows = normalizeRows(recordsByKey && recordsByKey[key]);

    rows.forEach((row) => {
      if (!rowContainsPlayer(row, player)) return;
      const opponent = findOpponent(row, player, indexes);
      if (!opponent) return;

      const playerWin = rowIsWin(row, player);
      addDirected(summaries, player, opponent, row, playerWin);
      addDirected(summaries, opponent, player, row, !playerWin);
    });
  });

  return Array.from(summaries.values()).map((item) => ({
    pairKey: item.pairKey,
    playerA: item.playerA,
    playerB: item.playerB,
    periods: finalizePeriods(item.periods),
  }));
}

function rateValue(stat) {
  return Number((Number(stat.rate || 0)).toFixed(4));
}

function summaryToDbRow(summary, updatedAt) {
  const playerA = summary.playerA || {};
  const playerB = summary.playerB || {};
  const periods = finalizePeriods(summary.periods || emptyPeriodStats());
  const row = {
    pair_key: summary.pairKey || pairKeyForPlayers(playerA, playerB),
    player_a_key: playerRecordKey(playerA),
    player_b_key: playerRecordKey(playerB),
    player_a_user_id: playerUserId(playerA),
    player_b_user_id: playerUserId(playerB),
    player_a_name: playerName(playerA),
    player_b_name: playerName(playerB),
    player_a_race: playerRace(playerA),
    player_b_race: playerRace(playerB),
    updated_at: updatedAt || new Date().toISOString(),
  };

  PERIOD_KEYS.forEach((period) => {
    const stat = periods[period];
    row[`${period}_wins`] = stat.wins;
    row[`${period}_losses`] = stat.losses;
    row[`${period}_total`] = stat.total;
    row[`${period}_rate`] = rateValue(stat);
  });

  return row;
}

function dbRowToPeriods(row, reverse) {
  const periods = emptyPeriodStats();
  PERIOD_KEYS.forEach((period) => {
    const wins = Number(row[`${period}_wins`] || 0);
    const losses = Number(row[`${period}_losses`] || 0);
    const total = Number(row[`${period}_total`] || wins + losses || 0);
    periods[period] = {
      total,
      wins: reverse ? losses : wins,
      losses: reverse ? wins : losses,
      rate: 0,
    };
  });
  return finalizePeriods(periods);
}

module.exports = {
  PERIOD_KEYS,
  safeRecordKey,
  safePairKey,
  normalizeRows,
  playerRecordKey,
  pairKeyForPlayers,
  summarizePair,
  buildHeadToHeadSummaries,
  summaryToDbRow,
  dbRowToPeriods,
};
