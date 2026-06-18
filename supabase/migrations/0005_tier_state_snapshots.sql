-- Compact public tier-state snapshots.
-- This table lets the public tierboard read players/meta/live status from Supabase
-- instead of opening several Firebase RTDB listeners. Raw match records remain in Storage.

create table if not exists public.tier_state_snapshots (
  snapshot_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tier_state_snapshots_updated_at
  on public.tier_state_snapshots (updated_at desc);

drop trigger if exists trg_set_updated_at on public.tier_state_snapshots;
create trigger trg_set_updated_at
  before update on public.tier_state_snapshots
  for each row execute function public.set_updated_at();

alter table public.tier_state_snapshots enable row level security;

-- No public SELECT policy by design. The public UI reads this through /api/tier-state,
-- which uses the server service key and returns a strict field whitelist.
