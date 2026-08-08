const DEFAULT_SOURCE =
  "https://calm-schedule.vercel.app/api/save-schedule";

function koreaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function clampLimit(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function buildItems(scheduleData, todayKey, options = {}) {
  const data = scheduleData && scheduleData.data ? scheduleData.data : scheduleData || {};
  const today = data.today || {};
  const monthly = data.monthly && typeof data.monthly === "object" ? data.monthly : {};
  const items = [];
  const limit = clampLimit(options.limit, 5, 1, 10);
  const includeUpcoming = options.includeUpcoming === true;

  const todaySchedule = cleanText(today.schedule);
  if (todaySchedule) {
    items.push({
      id: `today-schedule-${todayKey}`,
      title: "오늘의 일정",
      body: todaySchedule,
      date: todayKey,
      type: "today",
    });
  }

  const todayMention = cleanText(today.mention);
  if (todayMention) {
    items.push({
      id: `today-mention-${todayKey}`,
      title: "언급노(휴방)",
      body: todayMention,
      date: todayKey,
      type: "mention",
    });
  }

  if (includeUpcoming) {
    const upcoming = Object.entries(monthly)
      .map(([date, body]) => ({ date, body: cleanText(body) }))
      .filter(item => item.date >= todayKey && item.body)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, limit)
      .map(item => ({
        id: `monthly-${item.date}`,
        title: item.date === todayKey ? "월간 일정표" : "다가오는 일정",
        body: item.body,
        date: item.date,
        type: item.date === todayKey ? "today-monthly" : "upcoming",
      }));
    items.push(...upcoming);
  }

  return items.slice(0, limit);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const sourceUrl = process.env.SCHEDULE_SOURCE_URL || DEFAULT_SOURCE;
    const url = `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`;
    const upstream = await fetch(url, { cache: "no-store" });
    const raw = await upstream.text();
    let payload = {};

    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("schedule_json_parse_failed");
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        error: "schedule_upstream_error",
        code: "FETCH_FAILED",
        message: payload.error || raw.slice(0, 180),
        todayKey: koreaDateKey(),
        items: [],
        isEmpty: true,
        updatedAt: new Date().toISOString(),
      });
    }

    const todayKey = koreaDateKey();
    const items = buildItems(payload, todayKey, {
      includeUpcoming: req.query && String(req.query.includeUpcoming || "") === "1",
      limit: req.query && req.query.limit
    });

    return res.status(200).json({
      ok: true,
      todayKey,
      items,
      isEmpty: items.length === 0,
      updatedAt: new Date().toISOString(),
      source: "external-schedule",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "schedule_proxy_error",
      code: "FETCH_FAILED",
      message: error.message || String(error),
      todayKey: koreaDateKey(),
      items: [],
      isEmpty: true,
      updatedAt: new Date().toISOString(),
    });
  }
};
