const admin = require("firebase-admin");

const DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app";
const RANK_ROOT = process.env.SURVIVORS_RANK_ROOT || "monstarzSurvivors/rankings";
const SOOP_STATION_INFO_URL = "https://openapi.sooplive.com/user/stationinfo";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

function cleanText(value, fallback, max = 60) {
  const text = String(value || fallback || "").trim();
  return (text || String(fallback || "SOOP")).slice(0, max);
}

function cleanNumber(value, min = 0, max = 999999999) {
  const n = Math.floor(Number(value) || 0);
  return Math.max(min, Math.min(max, n));
}

function rankKey(value) {
  return Buffer.from(String(value || "SOOP"), "utf8").toString("base64url").slice(0, 120);
}

async function getSoopProfile(accessToken) {
  if (!accessToken || typeof accessToken !== "string") {
    const err = new Error("SOOP login is required.");
    err.status = 401;
    throw err;
  }

  const body = new URLSearchParams({ access_token: accessToken });
  const response = await fetch(SOOP_STATION_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await response.json().catch(() => null);
  const data = json && json.data ? json.data : {};
  if (!response.ok || !json || json.result !== 1 || !data.user_nick) {
    const err = new Error("SOOP access token could not be verified.");
    err.status = 401;
    throw err;
  }

  return {
    nick: cleanText(data.user_nick, "SOOP", 40),
    stationName: cleanText(data.station_name || data.user_id || data.user_nick, data.user_nick, 80),
  };
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const input = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const run = input.run || {};
    const profile = await getSoopProfile(input.soopAccessToken);
    const score = cleanNumber(run.score);

    if (score <= 0) {
      return res.status(412).json({
        error: "invalid_score",
        message: "Only ENDLESS records with kills can be ranked.",
      });
    }

    const payload = {
      nick: profile.nick,
      stationName: profile.stationName,
      score,
      endlessKills: cleanNumber(run.endlessKills),
      kills: cleanNumber(run.kills),
      stage: cleanNumber(run.stage, 1, 3),
      level: cleanNumber(run.level, 1, 999),
      time: cleanNumber(run.time),
      charId: cleanText(run.charId, "RUN", 20),
      charKo: cleanText(run.charKo, "", 40),
      race: cleanText(run.race, "", 16),
      updatedAt: Date.now(),
      updatedAtIso: new Date().toISOString(),
    };

    const ref = db().ref(`${RANK_ROOT}/${rankKey(profile.stationName)}`);
    let updated = false;
    let finalScore = score;

    await ref.transaction((current) => {
      const oldScore = cleanNumber(current && current.score);
      finalScore = Math.max(oldScore, score);
      if (score <= oldScore) return current || null;
      updated = true;
      return {
        ...(current || {}),
        ...payload,
        createdAt: current && current.createdAt ? current.createdAt : Date.now(),
        createdAtIso: current && current.createdAtIso ? current.createdAtIso : new Date().toISOString(),
      };
    });

    return res.status(200).json({ ok: true, updated, nick: profile.nick, score: finalScore });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.status === 401 ? "unauthenticated" : "ranking_submit_failed",
      message: err.message || String(err),
    });
  }
};
