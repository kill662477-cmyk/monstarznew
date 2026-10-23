const roster = require('../data/manual/players.json');
const {getR2Config, signedRequest, putJson} = require('../lib/r2/client');
const {objectKey} = require('../lib/r2/tier-state');
const {upsertTierStateSnapshots} = require('../lib/tier-state-snapshots');

function mergePlayers(existing) {
  const source = new Map(roster.map(p => [p.userId, p]));
  const seen = new Set();
  const rows = existing.map(player => {
    seen.add(player.userId);
    const update = source.get(player.userId);
    if (!update) return player;
    // Keep collected record/live fields and the established hidden-player policy.
    const next = {...player};
    for (const key of ['name', 'race', 'tierCode', 'tier', 'tierId', 'academy', 'sortOrder']) next[key] = update[key];
    return next;
  });
  const previousIds = new Set((process.env.PREVIOUS_ROSTER_IDS || '').split(',').filter(Boolean));
  // Only add newly registered players. Do not restore players hidden by collection.
  for (const player of roster) if (!seen.has(player.userId) && !previousIds.has(player.userId)) rows.push(player);
  return rows;
}

async function main() {
  if (!process.env.PREVIOUS_ROSTER_IDS) throw new Error('PREVIOUS_ROSTER_IDS is required to preserve hidden players');
  const response = await signedRequest(getR2Config(), {key: objectKey('core')});
  if (!response.ok) throw new Error(`R2 core read failed: ${response.status}`);
  const core = await response.json();
  if (!Array.isArray(core.players) || !core.players.length) throw new Error('Invalid R2 core players');
  const players = mergePlayers(core.players);
  const byId = new Map(roster.map(p => [p.userId, p]));
  const meta = {...core.meta, rosterUpdatedAt: new Date().toISOString(), sourcePlayerCount: roster.length, playerCount: roster.length};
  if (Array.isArray(meta.hiddenInactivePlayers)) meta.hiddenInactivePlayers = meta.hiddenInactivePlayers.map(p => {
    const update = byId.get(p.userId);
    return update ? {...p, tier: update.tier, race: update.race} : p;
  });
  const updated = {...core, updatedAt: new Date().toISOString(), source: 'publish-player-roster', players, meta};
  console.log(JSON.stringify({before: core.players.length, after: players.length, sourcePlayers: roster.length, apply: process.argv.includes('--apply')}));
  if (!process.argv.includes('--apply')) return;
  await upsertTierStateSnapshots({players, meta}, 'publish-player-roster');
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const admin = require('firebase-admin');
    const credential = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    credential.private_key = credential.private_key.replace(/\\n/g, '\n');
    const app = admin.initializeApp({credential: admin.credential.cert(credential), databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app'});
    try {
      const ref = app.database().ref('starcraftTier/current');
      const current = (await ref.child('players').once('value')).val();
      const rows = Array.isArray(current) ? current : Object.values(current || {});
      if (!rows.length) throw new Error('Empty Firebase player state');
      await ref.child('players').set(mergePlayers(rows));
      await ref.child('meta').update({rosterUpdatedAt: meta.rosterUpdatedAt, sourcePlayerCount: roster.length, playerCount: roster.length});
    } finally { await app.delete(); }
  }
  await putJson(objectKey('core'), updated, {cacheControl: 'public, max-age=120'});
  console.log('Roster published to Supabase, Firebase and R2; live and records preserved');
}
if (require.main === module) main().catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {mergePlayers};
