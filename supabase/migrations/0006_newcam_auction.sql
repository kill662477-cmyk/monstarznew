-- Newcam auction event tables.
-- Safe to run more than once.

create extension if not exists "pgcrypto";

create table if not exists public.newcam_teams (
  id uuid primary key default gen_random_uuid(),
  team_key text unique not null,
  team_name text not null,
  captain_name text,
  group_name text,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);

create table if not exists public.newcam_players (
  id uuid primary key default gen_random_uuid(),
  team_key text not null,
  player_name text not null,
  tier_label text,
  role_label text,
  race text,
  auction_points numeric,
  wins integer default 0,
  losses integer default 0,
  is_temporary boolean default false,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz,
  unique (team_key, player_name)
);

create table if not exists public.newcam_matches (
  id uuid primary key default gen_random_uuid(),
  match_type text default 'scrim',
  group_name text,
  round_label text,
  team_a_key text,
  team_b_key text,
  winner_team_key text,
  played_at timestamptz,
  status text default 'done',
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);

create table if not exists public.newcam_match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid,
  match_type text default 'scrim',
  game_no integer default 1,
  map_name text,
  team_key text,
  player_name text not null,
  opponent_name text,
  result text,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);

create index if not exists idx_newcam_teams_visible on public.newcam_teams (is_visible);
create index if not exists idx_newcam_teams_sort on public.newcam_teams (sort_order);
create index if not exists idx_newcam_teams_key on public.newcam_teams (team_key);

create index if not exists idx_newcam_players_visible on public.newcam_players (is_visible);
create index if not exists idx_newcam_players_team on public.newcam_players (team_key);
create index if not exists idx_newcam_players_sort on public.newcam_players (sort_order);

create index if not exists idx_newcam_matches_visible on public.newcam_matches (is_visible);
create index if not exists idx_newcam_matches_type on public.newcam_matches (match_type);
create index if not exists idx_newcam_matches_sort on public.newcam_matches (sort_order);

create index if not exists idx_newcam_match_players_visible on public.newcam_match_players (is_visible);
create index if not exists idx_newcam_match_players_match on public.newcam_match_players (match_id);
create index if not exists idx_newcam_match_players_player on public.newcam_match_players (player_name);

drop trigger if exists trg_set_updated_at on public.newcam_teams;
create trigger trg_set_updated_at before update on public.newcam_teams for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.newcam_players;
create trigger trg_set_updated_at before update on public.newcam_players for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.newcam_matches;
create trigger trg_set_updated_at before update on public.newcam_matches for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.newcam_match_players;
create trigger trg_set_updated_at before update on public.newcam_match_players for each row execute function public.set_updated_at();

alter table public.newcam_teams enable row level security;
drop policy if exists "public_select_visible" on public.newcam_teams;
create policy "public_select_visible" on public.newcam_teams for select to anon, authenticated using (is_visible = true);

alter table public.newcam_players enable row level security;
drop policy if exists "public_select_visible" on public.newcam_players;
create policy "public_select_visible" on public.newcam_players for select to anon, authenticated using (is_visible = true);

alter table public.newcam_matches enable row level security;
drop policy if exists "public_select_visible" on public.newcam_matches;
create policy "public_select_visible" on public.newcam_matches for select to anon, authenticated using (is_visible = true);

alter table public.newcam_match_players enable row level security;
drop policy if exists "public_select_visible" on public.newcam_match_players;
create policy "public_select_visible" on public.newcam_match_players for select to anon, authenticated using (is_visible = true);

insert into public.newcam_teams (team_key, team_name, captain_name, group_name, sort_order, is_visible)
values
  ('ginew', '기뉴다팀', '기뉴다', 'A', 10, true),
  ('chulgu', '철구팀', '철구', 'A', 20, true),
  ('parksungjun', '박성준팀', '박성준', 'A', 30, true),
  ('iyunyeol', '이윤열팀', '이윤열', 'B', 40, true),
  ('jeontae', '전태규팀', '전태규', 'B', 50, true),
  ('kimhaksu', '김학수팀', '김학수', 'B', 60, true)
on conflict (team_key) do update set
  team_name = excluded.team_name,
  captain_name = excluded.captain_name,
  group_name = excluded.group_name,
  sort_order = excluded.sort_order,
  is_visible = excluded.is_visible;

insert into public.newcam_players (team_key, player_name, tier_label, role_label, race, auction_points, is_temporary, sort_order, is_visible)
values
  ('chulgu', '철구', '조커이드', '팀장', 'Z', null, false, 10, true),
  ('chulgu', '김윤환', '잭티어', '잭티어', 'Z', 900, false, 20, true),
  ('chulgu', '시조새', '3티어', '3티어', 'P', 0, false, 30, true),
  ('chulgu', '최세상', '5티어', '4/5티어', 'T', 0, false, 40, true),
  ('chulgu', '비타밍', '6티어', '6티어', 'T', 0, false, 50, true),
  ('chulgu', '갱이다', '7티어', '7티어', 'T', 10, false, 60, true),
  ('parksungjun', '박성준', '조커이드', '팀장', 'Z', null, false, 10, true),
  ('parksungjun', '흑운장', '잭티어', '잭티어', 'T', 200, false, 20, true),
  ('parksungjun', '이유란', '3티어', '3티어', 'Z', 15, false, 30, true),
  ('parksungjun', '구루미', '4티어', '4/5티어', 'Z', 200, false, 40, true),
  ('parksungjun', '메옹', '6티어', '6티어', 'T', 160, false, 50, true),
  ('parksungjun', '막내현진', '7티어', '7티어', 'P', 5, false, 60, true),
  ('ginew', '기뉴다', '조커이드', '팀장', 'T', null, false, 10, true),
  ('ginew', '지동원', '잭티어', '잭티어', 'T', 0, false, 20, true),
  ('ginew', '지두두', '3티어', '3티어', 'T', 100, false, 30, true),
  ('ginew', '졈니', '4티어', '4/5티어', 'P', 360, false, 40, true),
  ('ginew', '2라니', '6티어', '6티어', 'Z', 5, false, 50, true),
  ('ginew', '퀸주', '7티어', '7티어', 'Z', 340, false, 60, true),
  ('iyunyeol', '이윤열', '조커이드', '팀장', 'T', null, false, 10, true),
  ('iyunyeol', '박재혁', '잭티어', '잭티어', 'Z', 25, false, 20, true),
  ('iyunyeol', '공다츠', '3티어', '3티어', 'Z', 100, false, 30, true),
  ('iyunyeol', '키링', '4티어', '4/5티어', 'P', 700, false, 40, true),
  ('iyunyeol', '임조이', '6티어', '6티어', 'Z', 95, false, 50, true),
  ('iyunyeol', '경콩', '7티어', '7티어', 'T', 5, false, 60, true),
  ('jeontae', '전태규', '조커이드', '팀장', 'P', null, false, 10, true),
  ('jeontae', '왜냐맨', '잭티어', '잭티어', 'P', 200, false, 20, true),
  ('jeontae', '박듀듀', '3티어', '3티어', 'P', 95, false, 30, true),
  ('jeontae', '치리', '5티어', '4/5티어', 'Z', 95, false, 40, true),
  ('jeontae', '박하악', '6티어', '6티어', 'Z', 175, false, 50, true),
  ('jeontae', '아리송이', '7티어', '7티어', 'P', 215, false, 60, true),
  ('kimhaksu', '김학수', '조커이드', '팀장', 'P', null, false, 10, true),
  ('kimhaksu', '이경민', '잭티어', '잭티어', 'P', 25, false, 20, true),
  ('kimhaksu', '토마토', '3티어', '3티어', 'P', 640, false, 30, true),
  ('kimhaksu', '오조은', '4티어', '4/5티어', 'T', 100, false, 40, true),
  ('kimhaksu', '정서린', '6티어', '6티어', 'P', 235, false, 50, true),
  ('kimhaksu', '먼진', '7티어', '7티어', 'Z', 0, false, 60, true)
on conflict (team_key, player_name) do update set
  tier_label = excluded.tier_label,
  role_label = excluded.role_label,
  race = excluded.race,
  auction_points = excluded.auction_points,
  is_temporary = excluded.is_temporary,
  sort_order = excluded.sort_order,
  is_visible = excluded.is_visible;

update public.newcam_players
set is_visible = false,
  hidden_at = now(),
  updated_at = now()
where player_name in ('3티어 미정', '5티어 미정', '6티어 미정', '7티어 미정');
