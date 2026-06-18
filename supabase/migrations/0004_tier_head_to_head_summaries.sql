-- Entry tab head-to-head summary index.
-- Raw match rows stay in private Supabase Storage. This table keeps only compact
-- pair summaries so the public entry UI does not fetch huge record files on player select.

create table if not exists public.tier_head_to_head_summaries (
  pair_key text primary key,
  player_a_key text not null,
  player_b_key text not null,
  player_a_user_id text,
  player_b_user_id text,
  player_a_name text,
  player_b_name text,
  player_a_race text,
  player_b_race text,

  m1_wins integer not null default 0,
  m1_losses integer not null default 0,
  m1_total integer not null default 0,
  m1_rate numeric(7,4) not null default 0,

  m3_wins integer not null default 0,
  m3_losses integer not null default 0,
  m3_total integer not null default 0,
  m3_rate numeric(7,4) not null default 0,

  y2026_wins integer not null default 0,
  y2026_losses integer not null default 0,
  y2026_total integer not null default 0,
  y2026_rate numeric(7,4) not null default 0,

  all_wins integer not null default 0,
  all_losses integer not null default 0,
  all_total integer not null default 0,
  all_rate numeric(7,4) not null default 0,

  source text not null default 'collect-data',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tier_h2h_player_a_key
  on public.tier_head_to_head_summaries (player_a_key);

create index if not exists idx_tier_h2h_player_b_key
  on public.tier_head_to_head_summaries (player_b_key);

create index if not exists idx_tier_h2h_updated_at
  on public.tier_head_to_head_summaries (updated_at desc);

drop trigger if exists trg_set_updated_at on public.tier_head_to_head_summaries;
create trigger trg_set_updated_at
  before update on public.tier_head_to_head_summaries
  for each row execute function public.set_updated_at();

alter table public.tier_head_to_head_summaries enable row level security;

-- No public SELECT policy by design. The public UI reads this only through
-- /api/tier-head-to-head, which whitelists response fields and uses the server service key.
