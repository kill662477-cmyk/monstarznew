const fs = require('fs');
const p = './monstarznew/index.html';
let html = fs.readFileSync(p, 'utf8');

const regex = /(userId: "sksmsskdsl10"[\s\S]*?\}).*?(\];)/;
const replacement = `$1,
   { name: "남덕선", userId: "rnaqpdrjf", type: "player", role: "학생", tier: 2, race: "Zerg", status: "offline",
      profileImage: "https://stimg.sooplive.com/LOGO/rn/rnaqpdrjf/m/rnaqpdrjf.webp",
      stream: "https://www.sooplive.com/station/rnaqpdrjf",
      live: "https://play.sooplive.com/rnaqpdrjf",
      youtube: "#",
      profile: "#" }
$2`;

if (regex.test(html)) {
    fs.writeFileSync(p, html.replace(regex, replacement), 'utf8');
    console.log('Successfully added Nam Deok-seon to MEMBERS array.');
} else {
    console.log('Regex did not match.');
}
