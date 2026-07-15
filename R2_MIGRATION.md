# Supabase Storage to Cloudflare R2

## Current migration scope

- `tier-records/**` -> `tier-records/**`
- `video-thumbnails/**` -> `video-thumbnails/**`
- `calmsv-assets/**` -> `calmsv-assets/**`
- `tier_state_snapshots` -> `tier-state/core.json`, `live.json`, `record-meta.json`

The API reads R2 first and falls back to Supabase. Collection jobs can dual-write to both during the transition.

## Cloudflare setup

1. Create the Standard-class bucket `monstarz-assets`.
2. Create an R2 API token with Object Read & Write, scoped to this bucket.
3. Copy `.env.r2.example` to a local ignored env file and fill the Account ID, Access Key ID, and Secret Access Key.
4. Publish the bucket with a custom domain for production, or an `r2.dev` URL for temporary testing.
5. Set `R2_PUBLIC_BASE_URL` to that public origin without a trailing slash.

Do not commit or paste the secret key into chat.

## Verify inventory

```powershell
npm.cmd run migrate:r2 -- --dry-run --env-file ..\card-gacha\.env.local
```

## Migrate

```powershell
npm.cmd run migrate:r2 -- --env-file ..\card-gacha\.env.local --env-file .env.r2.local
```

## Runtime variables

Add these to GitHub Actions and Vercel where applicable:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET=monstarz-assets
R2_PUBLIC_BASE_URL
R2_TIER_STATE_PREFIX=tier-state
R2_TIER_RECORD_PREFIX=tier-records
R2_TIER_STATE_UPLOAD=true
R2_TIER_RECORD_UPLOAD=true
```

For CALMSV, set `window.CALMSV_R2_PUBLIC_BASE_URL` in `CALMSV/r2-config.js` after the public origin is available.

Keep Supabase writes enabled until R2 reads and scheduled dual-writes are verified. Then disable Supabase Storage writes independently from the Supabase database plan.
