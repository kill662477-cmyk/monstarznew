const admin = require("firebase-admin");

const DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app";
const RANK_ROOT = process.env.SURVIVORS_RANK_ROOT || "monstarzSurvivors/rankings";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

function firebaseCredential() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (rawJson) return admin.credential.cert(JSON.parse(rawJson));

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  }

  throw new Error("Firebase service account env is missing.");
}

function db() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: firebaseCredential(),
      databaseURL: DATABASE_URL,
    });
  }
  return admin.database();
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
    const snapshot = await db().ref(RANK_ROOT).once("value");
    return res.status(200).json({ ok: true, rankings: cleanRows(snapshot.val()) });
  } catch (err) {
    return res.status(500).json({
      error: "ranking_read_failed",
      message: err.message || String(err),
    });
  }
};
