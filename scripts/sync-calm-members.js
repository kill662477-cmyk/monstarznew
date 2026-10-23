const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const team = require('../data/manual/calm-members.json').members;

function replaceArray(html, marker, rows) {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`Missing ${marker}`);
  const start = html.indexOf('[', at);
  const end = html.indexOf('];', start) + 1;
  if (end <= start) throw new Error(`Invalid ${marker}`);
  return html.slice(0, start) + JSON.stringify(rows, null, 2) + html.slice(end);
}

for (const file of ['index.html', 'mobile/index.html']) {
  const target = path.join(root, file);
  let html = fs.readFileSync(target, 'utf8');
  html = replaceArray(html, 'const MEMBERS', team.map(p => p.member));
  const mobile = file.startsWith('mobile/');
  html = replaceArray(html, mobile ? 'const PROFILE_MEMBERS' : 'var PROFILE_MEMBERS', team.map(p => p.profile));
  if (mobile) {
    const images = Object.fromEntries(team.map(({member, profile}) => [member.name, {image: profile.image, fallbackImage: profile.fallbackImage, imagePos: profile.imagePos || '50% 50%'}]));
    html = html.replace(/const PROFILE_IMAGE_MAP=[^\r\n]*/, 'const PROFILE_IMAGE_MAP=' + JSON.stringify(images) + ';');
    html = html.replace('m.name==="낭니"?"유스":', '');
  } else {
    html = html.replace('const JOIN_DATES = {', 'const JOIN_DATES = {\n    "진영화": "2026-10-22",\n    "서희": "2026-10-22",');
    // Idempotent join dates when the generator is run again.
    html = html.replace(/("진영화": "2026-10-22",\s*"서희": "2026-10-22",\s*)+/g, '$1');
  }
  const event = '{ date: "26.10.22", events: [{ name: "진영화", race: "P", status: "IN" }, { name: "서희", race: "P", status: "IN" }] }';
  const historyAt = html.indexOf('const INOUT_HISTORY');
  if (historyAt >= 0 && !html.slice(historyAt, html.indexOf('];', historyAt)).includes('26.10.22')) {
    const end = html.indexOf('];', historyAt);
    html = html.slice(0, end).trimEnd() + ',\n    ' + event + '\n  ' + html.slice(end);
  }
  fs.writeFileSync(target, html);
}
console.log(`Synced ${team.length} CALM members and profiles to desktop and mobile`);
