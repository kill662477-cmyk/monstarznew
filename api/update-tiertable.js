const { getServerConfig } = require('../../lib/supabase/server');

module.exports = async function handler(req, res) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { password, photos } = req.body;
    
    // Check password
    if (password !== "!rkxh141256") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!photos || typeof photos !== "object") {
      return res.status(400).json({ error: "Invalid photos payload" });
    }

    const cfg = getServerConfig();
    if (!cfg.ready) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    // Upload to Supabase Storage
    const bucket = "calmsv-assets";
    const path = "tiertable/photos.json";
    const url = `${cfg.url}/storage/v1/object/${bucket}/${path}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': cfg.serviceKey,
        'Authorization': `Bearer ${cfg.serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(photos, null, 2)
    });

    // If POST fails because it already exists, try PUT
    if (response.status === 400 || response.status === 409) {
      const putRes = await fetch(url, {
        method: 'PUT',
        headers: {
          'apikey': cfg.serviceKey,
          'Authorization': `Bearer ${cfg.serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(photos, null, 2)
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed: ${await putRes.text()}`);
      }
    } else if (!response.ok) {
      throw new Error(`Upload failed: ${await response.text()}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("update-photos error:", err);
    return res.status(500).json({ error: err.message });
  }
};
