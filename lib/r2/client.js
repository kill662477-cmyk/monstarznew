const crypto = require("crypto");

function clean(value) {
  return String(value || "").trim();
}

function normalizePrefix(value) {
  return clean(value).replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

function getR2Config(env = process.env) {
  const accountId = clean(env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID);
  const accessKeyId = clean(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(env.R2_SECRET_ACCESS_KEY);
  const bucket = clean(env.R2_BUCKET || env.R2_BUCKET_NAME || "monstarz-assets");
  const publicBaseUrl = clean(env.R2_PUBLIC_BASE_URL).replace(/\/+$/, "");
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
    endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "",
    ready: Boolean(accountId && accessKeyId && secretAccessKey && bucket),
  };
}

function sha256(value, encoding = "hex") {
  return crypto.createHash("sha256").update(value).digest(encoding);
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalPath(bucket, objectKey) {
  const parts = [bucket];
  const normalized = normalizePrefix(objectKey);
  if (normalized) parts.push(...normalized.split("/"));
  return `/${parts.map(awsEncode).join("/")}`;
}

function amzTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secretAccessKey, dateStamp) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

async function signedRequest(config, options = {}) {
  if (!config || !config.ready) {
    const error = new Error("R2 credentials are not configured");
    error.code = "r2_not_configured";
    throw error;
  }

  const method = String(options.method || "GET").toUpperCase();
  const body = options.body == null
    ? Buffer.alloc(0)
    : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(options.body);
  const path = canonicalPath(config.bucket, options.key || "");
  const url = `${config.endpoint}${path}`;
  const host = new URL(config.endpoint).host;
  const amzDate = amzTimestamp();
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const signed = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  if (options.contentType) signed["content-type"] = options.contentType;
  if (options.cacheControl) signed["cache-control"] = options.cacheControl;

  const signedNames = Object.keys(signed).sort();
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${String(signed[name]).trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = signedNames.join(";");
  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp), stringToSign, "hex");

  const headers = {
    ...signed,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };

  return fetch(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

async function ensureBucket(config = getR2Config()) {
  const response = await signedRequest(config, { method: "PUT" });
  if (response.ok || response.status === 409) {
    return { created: response.ok, existed: response.status === 409 };
  }
  const text = await response.text();
  throw new Error(`r2_bucket_create_failed_${response.status}: ${text.slice(0, 240)}`);
}

async function putObject(key, body, options = {}, config = getR2Config()) {
  const response = await signedRequest(config, {
    method: "PUT",
    key,
    body,
    contentType: options.contentType || "application/octet-stream",
    cacheControl: options.cacheControl || "public, max-age=300",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`r2_upload_failed_${response.status}: ${text.slice(0, 240)}`);
  }
  return {
    key: normalizePrefix(key),
    bytes: Buffer.byteLength(body),
    etag: response.headers.get("etag"),
    publicUrl: config.publicBaseUrl
      ? `${config.publicBaseUrl}/${normalizePrefix(key)}`
      : null,
  };
}

async function putJson(key, value, options = {}, config = getR2Config()) {
  const body = Buffer.from(JSON.stringify(value));
  return putObject(
    key,
    body,
    {
      contentType: "application/json; charset=utf-8",
      cacheControl: options.cacheControl || "public, max-age=60",
    },
    config
  );
}

module.exports = {
  ensureBucket,
  getR2Config,
  normalizePrefix,
  putJson,
  putObject,
  signedRequest,
};
