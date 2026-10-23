const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const team = require('../data/manual/calm-members.json').members;
const roster = require('../data/manual/players.json');
function extract(file, marker) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const at = text.indexOf(marker), start = text.indexOf('[', at), end = text.indexOf('];', start) + 1;
  assert.ok(at >= 0 && end > start);
  return Function('return ' + text.slice(start, end))();
}
test('desktop/mobile members and profiles match the current CALM source', () => {
  const expected = team.map(p => p.member.userId).sort();
  assert.equal(expected.length, 19);
  assert.deepEqual(expected, roster.filter(p => p.academy?.id === 22).map(p => p.userId).sort());
  for (const file of ['index.html', 'mobile/index.html']) {
    assert.deepEqual(extract(file, 'const MEMBERS'), team.map(p => p.member));
    const profiles = extract(file, file.startsWith('mobile') ? 'const PROFILE_MEMBERS' : 'var PROFILE_MEMBERS');
    assert.deepEqual(profiles, team.map(p => p.profile));
    for (const p of profiles) if (p.image.startsWith('/')) assert.ok(fs.existsSync(path.join(root, p.image.slice(1))));
    const events = extract(file, 'const INOUT_HISTORY');
    assert.ok(events.some(day => day.date === '26.10.19' && day.events.some(e => e.name === '김지성' && e.status === 'IN')));
    for (const name of ['진영화', '서희']) assert.ok(events.some(day => day.date === '26.10.22' && day.events.some(e => e.name === name && e.status === 'IN')));
  }
});
test('roster publication preserves hidden players and collected state', () => {
  const {mergePlayers} = require('../scripts/publish-player-roster');
  const previous = process.env.PREVIOUS_ROSTER_IDS;
  process.env.PREVIOUS_ROSTER_IDS = roster.map(p => p.userId).join(',');
  try {
    const player = roster[0];
    const result = mergePlayers([{...player, tier: 'old', recordCount: 123, live: true}]);
    assert.equal(result.length, 1);
    assert.equal(result[0].tier, player.tier);
    assert.equal(result[0].recordCount, 123);
    assert.equal(result[0].live, true);
    process.env.PREVIOUS_ROSTER_IDS = roster.slice(0, -1).map(p => p.userId).join(',');
    const appended = mergePlayers([]);
    assert.deepEqual(appended.map(p => p.userId), [roster.at(-1).userId]);
  } finally {
    if (previous === undefined) delete process.env.PREVIOUS_ROSTER_IDS;
    else process.env.PREVIOUS_ROSTER_IDS = previous;
  }
});
