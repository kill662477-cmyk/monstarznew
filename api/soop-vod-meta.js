function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function getSoopVodId(value) {
  const raw = String(value || "").trim();
  const direct = raw.match(/(?:^|\/)player\/(\d+)(?:[/?#]|$)/i);
  if (direct) return direct[1];
  if (/^\d+$/.test(raw)) return raw;
  return "";
}

function normalizeVodUrl(value) {
  const raw = String(value || "").trim();
  const id = getSoopVodId(raw);
  if (!id) return null;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host !== "vod.sooplive.com" && host !== "vod.afreecatv.com") return null;
  } catch (error) {
    if (!/^\d+$/.test(raw)) return null;
  }

  return {
    id,
    url: "https://vod.sooplive.com/player/" + id
  };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function attrValue(tag, name) {
  const re = new RegExp("\\s" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i");
  const match = String(tag || "").match(re);
  return match ? decodeHtml(match[2]) : "";
}

function metaContent(html, key) {
  const tags = String(html || "").match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = attrValue(tag, "property") || attrValue(tag, "name");
    if (String(property).toLowerCase() === String(key).toLowerCase()) {
      return attrValue(tag, "content");
    }
  }
  return "";
}

function jsonLdThumbnail(html) {
  const blocks = String(html || "").match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const data = JSON.parse(body);
      const thumbnail = Array.isArray(data.thumbnailUrl) ? data.thumbnailUrl[0] : data.thumbnailUrl;
      if (thumbnail) return String(thumbnail);
    } catch (error) {}
  }
  return "";
}

function sanitizeEmbedHtml(html) {
  const raw = String(html || "");
  const iframeMatch = raw.match(/<iframe\b[\s\S]*?<\/iframe>/i);
  if (!iframeMatch) return "";
  const tag = iframeMatch[0];
  const src = attrValue(tag, "src");
  if (!src) return "";

  try {
    const parsed = new URL(src, "https://vod.sooplive.com");
    if (parsed.hostname.toLowerCase() !== "vod.sooplive.com") return "";
    if (!/^\/player\/\d+\/embed/i.test(parsed.pathname)) return "";
    return "<iframe src=\"" + parsed.href.replace(/"/g, "&quot;") + "\" width=\"960\" height=\"540\" frameborder=\"0\" allow=\"accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture\" allowfullscreen></iframe>";
  } catch (error) {
    return "";
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 MonstarzNew/1.0",
      "accept": "text/html,application/json;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.text();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed", code: "METHOD_NOT_ALLOWED" });

  try {
    const normalized = normalizeVodUrl((req.query && (req.query.url || req.query.vodUrl || req.query.id)) || "");
    if (!normalized) {
      return res.status(400).json({ ok: false, error: "invalid_soop_vod_url", code: "INVALID_URL" });
    }

    const width = clampNumber(req.query && req.query.width, 960, 320, 1920);
    const height = clampNumber(req.query && req.query.height, 540, 180, 1080);
    const [pageHtml, oembedText] = await Promise.all([
      fetchText(normalized.url),
      fetchText("https://openapi.sooplive.com/oembed/embedinfo?vod_url=" + encodeURIComponent(normalized.url) + "&width=" + encodeURIComponent(width) + "&height=" + encodeURIComponent(height)).catch(() => "{}")
    ]);
    let oembed = {};
    try { oembed = JSON.parse(oembedText); } catch (error) {}

    const thumbnail =
      metaContent(pageHtml, "og:image") ||
      metaContent(pageHtml, "twitter:image") ||
      jsonLdThumbnail(pageHtml);
    const title =
      (oembed && oembed.title) ||
      metaContent(pageHtml, "og:title") ||
      metaContent(pageHtml, "twitter:title") ||
      "";
    const html = sanitizeEmbedHtml((oembed && (oembed.html || oembed.embed_html || oembed.embedHtml)) || metaContent(pageHtml, "og:video"));

    return res.status(200).json({
      ok: true,
      id: normalized.id,
      url: normalized.url,
      title,
      thumbnail,
      thumbnail_url: thumbnail,
      html
    });
  } catch (error) {
    console.warn("[soop-vod-meta] unavailable:", error && error.message);
    return res.status(502).json({ ok: false, error: "soop_vod_meta_unavailable", code: "FETCH_FAILED" });
  }
};
