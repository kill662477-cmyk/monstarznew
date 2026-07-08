const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '../index.html');
let html = fs.readFileSync(p, 'utf8');

const target = `   { name: "낭니", userId: "sksmsskdsl10", type: "player", role: "학생", tier: 9, race: "Zerg", status: "offline",
      profileImage: "https://stimg.sooplive.com/LOGO/sk/sksmsskdsl10/m/sksmsskdsl10.webp",
      stream: "https://www.sooplive.com/station/sksmsskdsl10",
      live: "https://play.sooplive.com/sksmsskdsl10",
      youtube: "#",
      profile: "#" }
];`;

const replacement = `   { name: "낭니", userId: "sksmsskdsl10", type: "player", role: "학생", tier: 9, race: "Zerg", status: "offline",
      profileImage: "https://stimg.sooplive.com/LOGO/sk/sksmsskdsl10/m/sksmsskdsl10.webp",
      stream: "https://www.sooplive.com/station/sksmsskdsl10",
      live: "https://play.sooplive.com/sksmsskdsl10",
      youtube: "#",
      profile: "#" },
   { name: "남덕선", userId: "rnaqpdrjf", type: "player", role: "학생", tier: 2, race: "Zerg", status: "offline",
      profileImage: "https://stimg.sooplive.com/LOGO/rn/rnaqpdrjf/m/rnaqpdrjf.webp",
      stream: "https://www.sooplive.com/station/rnaqpdrjf",
      live: "https://play.sooplive.com/rnaqpdrjf",
      youtube: "#",
      profile: "#" }
];`;

if (html.includes(target)) {
    fs.writeFileSync(p, html.replace(target, replacement), 'utf8');
    console.log('Successfully updated MEMBERS array.');
} else {
    console.log('Target block not found!');
}
