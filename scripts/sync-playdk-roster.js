const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

async function list(resource, query = '') {
  const rows = [];
  for (let page = 0; page < 40; page++) {
    const response = await fetch(`https://www.playdk.kr/api/v2/p/starcraft/soop/${resource}?page=${page}&size=500${query}`, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`${resource}: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error(`Invalid ${resource} response`);
    rows.push(...body.data);
    if (!body.more) return rows;
  }
  throw new Error(`Incomplete ${resource} pagination`);
}

async function main() {
  const file = path.join(root, 'data/manual/players.json');
  const players = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tiers = new Map(players.map(p => [p.tierCode, p.tier]));
  const [upstream, academies, memberships] = await Promise.all([
    list('player', '&enabled=true'), list('academy', '&visible=true'), list('academy/player'),
  ]);
  if (!upstream.length || !academies.length || !memberships.length) throw new Error('Empty upstream roster');
  const academyById = new Map(academies.filter(a => !a.dismantled && a.activated !== false).map(a => [a.id, a]));
  const membershipByPlayer = new Map();
  for (const member of memberships) {
    if (!academyById.has(member.academyId)) continue;
    const old = membershipByPlayer.get(member.playerId);
    if (!old || String(member.updatedAt || member.createdAt) > String(old.updatedAt || old.createdAt)) membershipByPlayer.set(member.playerId, member);
  }
  const byId = new Map(players.map(p => [p.userId.toLowerCase(), p]));
  const added = [], moved = [];
  for (const source of upstream) {
    if (source.enabled !== true || source.activated === false) continue;
    if (!tiers.has(source.tier) || !['T', 'Z', 'P', 'A'].includes(source.race)) throw new Error(`Unknown tier/race: ${source.userId}`);
    let player = byId.get(source.userId.toLowerCase());
    if (!player) {
      player = {id: source.id, userId: source.userId, name: source.name, description: source.description || '', eloboardKey: source.eloboardKey || '', elo: '', image: source.profileImageUrl || '', sourceImage: source.profileImageUrl || '', station: `https://www.sooplive.com/station/${source.userId}`, academy: null, monthWinRate: null, yearWinRate: null, winRate: ''};
      for (const key of ['image', 'sourceImage']) if (player[key].startsWith('//')) player[key] = 'https:' + player[key];
      players.push(player);
      byId.set(source.userId.toLowerCase(), player);
      added.push(player.name);
    }
    Object.assign(player, {race: source.race, tierCode: source.tier, tier: tiers.get(source.tier), tierId: `tier-${source.tier}`, sortOrder: source.sortOrder});
    const member = membershipByPlayer.get(source.id);
    const academy = member && academyById.get(member.academyId);
    const next = academy ? {id: academy.id, name: academy.name, image: academy.logoImageUrl || '', sourceImage: academy.logoImageUrl || '', position: member.position || ''} : null;
    if ((player.academy?.id || null) !== (next?.id || null)) moved.push({name: player.name, from: player.academy?.name || '무소속', to: next?.name || '무소속'});
    player.academy = next;
  }
  const names = new Set();
  for (const player of players) {
    if (names.has(player.name)) throw new Error(`Duplicate name: ${player.name}`);
    names.add(player.name);
  }
  fs.writeFileSync(file, JSON.stringify(players, null, 2) + '\n');
  console.log(JSON.stringify({activeUpstream: upstream.length, total: players.length, added, moved}, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
