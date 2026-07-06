const fs = require('fs');
const path = require('path');
const { getServerConfig } = require('../lib/supabase/server');

async function run() {
  const cfg = getServerConfig();
  if (!cfg.ready) {
    console.error("Supabase not configured");
    process.exit(1);
  }

  const tiertableRoot = "C:/Users/silve/OneDrive/Desktop/tiertable";
  const mmrPath = path.join(tiertableRoot, 'data', 'mmr-result.json');
  const indexHtmlPath = path.join(tiertableRoot, 'index.html');

  // Upload mmr-result.json
  const mmrResult = fs.readFileSync(mmrPath, 'utf8');
  await uploadToSupabase(cfg, 'tiertable/mmr-result.json', mmrResult);

  // Extract PHOTOS and upload
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const match = indexHtml.match(/const PHOTOS = (\{[\s\S]*?\});/);
  if (match) {
    // We parse the string to ensure valid JSON
    let photosObj = {};
    try {
      photosObj = eval('(' + match[1] + ')');
    } catch(e) {
      console.error("Error evaluating PHOTOS object");
    }
    await uploadToSupabase(cfg, 'tiertable/photos.json', JSON.stringify(photosObj, null, 2));
  } else {
    console.error("Could not find PHOTOS in index.html");
  }

  console.log("Upload completed!");
}

async function uploadToSupabase(cfg, filepath, content) {
  const bucket = "calmsv-assets";
  const url = `${cfg.url}/storage/v1/object/${bucket}/${filepath}`;
  
  const headers = {
    'apikey': cfg.serviceKey,
    'Authorization': `Bearer ${cfg.serviceKey}`,
    'Content-Type': 'application/json'
  };

  let res = await fetch(url, { method: 'POST', headers, body: content });
  if (res.status === 400 || res.status === 409) {
    res = await fetch(url, { method: 'PUT', headers, body: content });
  }

  if (!res.ok) {
    console.error(`Upload failed for ${filepath}:`, await res.text());
  } else {
    console.log(`Uploaded ${filepath}`);
  }
}

run();
