const soopRateBuckets = globalThis.__MONSTARZ_SOOP_TOKEN_BUCKETS || (globalThis.__MONSTARZ_SOOP_TOKEN_BUCKETS = new Map());
const SOOP_DEFAULT_REDIRECT_URI = "https://monstarznew.vercel.app/";

function rateLimit(req, res) {
  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 20;
  let bucket = soopRateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    soopRateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= max) return true;
  res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
  res.status(429).json({ error: "rate_limited", code: "RATE_LIMITED", message: "Too many requests. Please try again soon." });
  return false;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!rateLimit(req, res)) return;

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const clientId = process.env.SOOP_CLIENT_ID || body.client_id;
    const clientSecret = process.env.SOOP_CLIENT_SECRET;
    const redirectUri = process.env.SOOP_REDIRECT_URI || body.redirect_uri || SOOP_DEFAULT_REDIRECT_URI;
    const code = body.code || body.authCode;

    if (!clientId) throw new Error("Missing SOOP_CLIENT_ID.");
    if (!clientSecret) throw new Error("Missing SOOP_CLIENT_SECRET.");
    if (!code) throw new Error("Missing code/authCode.");

    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
    form.set("redirect_uri", redirectUri);
    form.set("code", code);

    const soopRes = await fetch("https://openapi.sooplive.com/auth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "*/*"
      },
      body: form
    });

    const raw = await soopRes.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!soopRes.ok || data.error) {
      return res.status(soopRes.status || 500).json({
        error: data.error || "soop_token_error",
        code: data.code || "SOOP_TOKEN_ERROR",
        message: data.message || data.error_description || raw || "SOOP token request failed."
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "server_error",
      code: "SERVER_ERROR",
      message: err.message || String(err)
    });
  }
}
