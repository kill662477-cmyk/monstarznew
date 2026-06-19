const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function readRequired(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return fs.readFileSync(fullPath, "utf8");
}

function assertContains(relativePath, content, needles) {
  for (const needle of needles) {
    if (!content.includes(needle)) {
      throw new Error(`${relativePath} is missing "${needle}"`);
    }
  }
}

function parseJson(relativePath) {
  JSON.parse(readRequired(relativePath));
}

const index = readRequired("index.html");
const mobile = readRequired(path.join("mobile", "index.html"));
const robots = readRequired("robots.txt");
const sitemap = readRequired("sitemap.xml");

assertContains("index.html", index, [
  "<!DOCTYPE html>",
  "</html>",
  "캄몬스타즈 팬페이지",
  "/assets/og-default.png",
  "/manifest.webmanifest"
]);

assertContains("mobile/index.html", mobile, [
  "<!DOCTYPE html>",
  "</html>",
  "캄몬스타즈 팬페이지",
  "/assets/og-default.png"
]);

assertContains("robots.txt", robots, ["Sitemap:", "Disallow: /api/admin/"]);
assertContains("sitemap.xml", sitemap, ["https://monstarznew.vercel.app/"]);

parseJson("package.json");
parseJson("manifest.webmanifest");
parseJson(path.join("mobile", "manifest.webmanifest"));
parseJson("vercel.json");

console.log("Static site validation passed.");
