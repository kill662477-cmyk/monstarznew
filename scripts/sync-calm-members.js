const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const {members: team, admissions} = require('../data/manual/calm-members.json');

function replaceArray(html, marker, rows) {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`Missing ${marker}`);
  const start = html.indexOf('[', at);
  const end = html.indexOf('];', start) + 1;
  if (end <= start) throw new Error(`Invalid ${marker}`);
  return html.slice(0, start) + JSON.stringify(rows, null, 2) + html.slice(end);
}

let sharedHistory;
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
    html = html.replace(/const JOIN_DATES = (\{[\s\S]*?\});/, (_, literal) => {
      const dates = Function('return (' + literal + ')')();
      for (const admission of admissions) dates[admission.name] = admission.date;
      return 'const JOIN_DATES = ' + JSON.stringify(dates, null, 2) + ';';
    });
  }
  const historyAt = html.indexOf('const INOUT_HISTORY');
  if (historyAt >= 0) {
    const start = html.indexOf('[', historyAt), end = html.indexOf('];', start) + 1;
    const history = sharedHistory || Function('return ' + html.slice(start, end))();
    for (const admission of admissions) {
      const date = admission.date.slice(2).replaceAll('-', '.');
      let day = history.find(row => row.date === date);
      if (!day) {day = {date, events: []}; history.push(day);}
      if (!day.events.some(event => event.name === admission.name && event.status === 'IN')) day.events.push({name: admission.name, race: admission.race, status: 'IN'});
    }
    history.sort((a, b) => a.date.localeCompare(b.date));
    sharedHistory = history;
    html = replaceArray(html, 'const INOUT_HISTORY', history);
  }
  fs.writeFileSync(target, html);
}
console.log(`Synced ${team.length} CALM members and profiles to desktop and mobile`);
