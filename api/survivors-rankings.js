const crypto = require("crypto");

const DATABASE_URL = (
  process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app"
).replace(/\/+$/, "");
const RANK_ROOT = process.env.SURVIVORS_RANK_ROOT || "monstarzSurvivors/rankings";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";

let cachedToken = null;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

function serviceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (rawJson) return JSON.parse(rawJson);

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }

  throw new Error("Firebase service account env is missing.");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token;

  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google token HTTP ${response.status}`);
  }

  cachedToken = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function readDb(path) {
  const token = await getAccessToken();
  const response = await fetch(`${DATABASE_URL}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data && data.error) || `Realtime Database HTTP ${response.status}`);
  return data;
}

function cleanRows(value) {
  return Object.entries(value || {})
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter((row) => Number(row.score || 0) > 0)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 10);
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const value = await readDb(RANK_ROOT);
    return res.status(200).json({ ok: true, rankings: cleanRows(value) });
  } catch (err) {
    return res.status(500).json({
      error: "ranking_read_failed",
      message: err.message || String(err),
    });
  }
};
