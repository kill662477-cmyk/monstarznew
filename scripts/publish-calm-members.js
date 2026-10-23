const {rest} = require('../lib/supabase/admin');
const team = require('../data/manual/calm-members.json').members;

async function main() {
  const apply = process.argv.includes('--apply');
  const [members, profiles, events] = await Promise.all(['members_admin', 'member_profiles', 'inout_events'].map(table => rest('GET', table, {query: '?select=*'})));
  const names = new Set(team.map(p => p.member.name));
  const ids = new Set(team.map(p => p.member.userId));
  console.log(JSON.stringify({members: team.length, hideMembers: members.filter(p => p.is_visible && !ids.has(p.member_code)).map(p => p.name), hideProfiles: profiles.filter(p => p.is_visible && !names.has(p.name)).map(p => p.name), apply}));
  if (!apply) return;
  for (let i = 0; i < team.length; i++) {
    const {member: m, profile: p} = team[i];
    const row = {member_code: m.userId, name: m.name, race: m.race, tier: String(m.tier), role: m.role, soop_id: m.userId, youtube_url: m.youtube === '#' ? null : m.youtube, profile_image: m.profileImage, sort_order: i, is_visible: true, hidden_at: null};
    await rest('POST', 'members_admin', {query: '?on_conflict=member_code', body: [row], prefer: 'resolution=merge-duplicates,return=minimal'});
    const profile = {member_code: m.userId, name: p.name, role: p.role, image: p.image, fallback_image: p.fallbackImage, image_pos: p.imagePos || '50% 50%', birth: p.birth || null, blood: p.blood || null, mbti: p.mbti || null, height: p.height || null, debut: p.debut || null, awards: p.awards.join('\n') || null, sort_order: i, is_visible: true, hidden_at: null};
    const existing = profiles.find(row => row.member_code === m.userId || row.name === p.name);
    await rest(existing ? 'PATCH' : 'POST', 'member_profiles', {query: existing ? '?id=eq.' + existing.id : '', body: profile, prefer: 'return=minimal'});
  }
  for (const [table, rows, keep] of [['members_admin', members, row => ids.has(row.member_code)], ['member_profiles', profiles, row => names.has(row.name)]]) {
    for (const row of rows) if (row.is_visible && !keep(row)) await rest('PATCH', table, {query: '?id=eq.' + row.id, body: {is_visible: false, hidden_at: new Date().toISOString()}, prefer: 'return=minimal'});
  }
  for (const name of ['진영화', '서희']) {
    if (events.some(e => e.member_name === name && e.event_date === '2026-10-22' && e.event_type === 'IN')) continue;
    await rest('POST', 'inout_events', {body: {member_name: name, event_type: 'IN', event_date: '2026-10-22', race: 'P', is_visible: true, sort_order: events.length}, prefer: 'return=minimal'});
  }
  console.log('Published 19 members/profiles and verified October 22 admission events');
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
