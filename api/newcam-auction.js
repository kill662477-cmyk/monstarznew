// Public Newcam auction data. Service key stays server-side.
const admin = require("../lib/supabase/admin");

function sortByOrder(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) =>
    Number(a.sort_order || 0) - Number(b.sort_order || 0)
  );
}

function visibleQuery(select) {
  return "?select=" + select + "&is_visible=eq.true&order=sort_order.asc";
}

function teamRow(row) {
  return {
    id: row.id,
    team_key: row.team_key || "",
    team_name: row.team_name || "",
    captain_name: row.captain_name || "",
    group_name: row.group_name || "",
    sort_order: Number(row.sort_order || 0)
  };
}

function playerRow(row) {
  return {
    id: row.id,
    team_key: row.team_key || "",
    player_name: row.player_name || "",
    tier_label: row.tier_label || "",
    role_label: row.role_label || "",
    race: row.race || "",
    auction_points: row.auction_points === null || row.auction_points === undefined ? null : Number(row.auction_points),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    is_temporary: Boolean(row.is_temporary),
    sort_order: Number(row.sort_order || 0)
  };
}

function matchRow(row) {
  return {
    id: row.id,
    match_type: row.match_type || "scrim",
    group_name: row.group_name || "",
    round_label: row.round_label || "",
    team_a_key: row.team_a_key || "",
    team_b_key: row.team_b_key || "",
    winner_team_key: row.winner_team_key || "",
    played_at: row.played_at || "",
    status: row.status || "",
    sort_order: Number(row.sort_order || 0)
  };
}

function matchPlayerRow(row) {
  return {
    id: row.id,
    match_id: row.match_id || "",
    match_type: row.match_type || "scrim",
    game_no: Number(row.game_no || 0),
    map_name: row.map_name || "",
    team_key: row.team_key || "",
    player_name: row.player_name || "",
    opponent_name: row.opponent_name || "",
    result: row.result || "",
    is_mercenary: row.is_mercenary === true,
    sort_order: Number(row.sort_order || 0)
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=180");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const [teams, players, matches, matchPlayers] = await Promise.all([
      admin.rest("GET", "newcam_teams", { query: visibleQuery("id,team_key,team_name,captain_name,group_name,sort_order") }),
      admin.rest("GET", "newcam_players", { query: visibleQuery("id,team_key,player_name,tier_label,role_label,race,auction_points,wins,losses,is_temporary,sort_order") }),
      admin.rest("GET", "newcam_matches", { query: visibleQuery("id,match_type,group_name,round_label,team_a_key,team_b_key,winner_team_key,played_at,status,sort_order") }),
      admin.rest("GET", "newcam_match_players", { query: visibleQuery("id,match_id,match_type,game_no,map_name,team_key,player_name,opponent_name,result,is_mercenary,sort_order") })
    ]);

    return res.status(200).json({
      ok: true,
      ready: true,
      updatedAt: new Date().toISOString(),
      teams: sortByOrder(teams).map(teamRow),
      players: sortByOrder(players).map(playerRow),
      matches: sortByOrder(matches).map(matchRow),
      matchPlayers: sortByOrder(matchPlayers).map(matchPlayerRow)
    });
  } catch (error) {
    return res.status(200).json({
      ok: true,
      ready: false,
      error: "newcam_auction_unavailable",
      updatedAt: new Date().toISOString(),
      teams: [],
      players: [],
      matches: [],
      matchPlayers: []
    });
  }
};
