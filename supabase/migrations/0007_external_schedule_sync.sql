-- 외부 일정표(tscam-schedule, Netlify) 동기화 미러 테이블.
-- 원본 편집은 계속 외부 사이트에서 하고, GitHub Actions가 주기적으로 이 테이블만 덮어씀.
-- 디자인/조회 방식은 추후 프론트에서 정함 - 여기서는 원본 구조를 그대로 보존.
-- Safe to run more than once.

create table if not exists public.external_schedule_sync (
  id text primary key default 'tscam',
  weekly jsonb not null default '{}'::jsonb,
  today jsonb not null default '{}'::jsonb,
  monthly jsonb not null default '{}'::jsonb,
  source_updated_at text,
  synced_at timestamptz not null default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_set_updated_at on public.external_schedule_sync;
create trigger trg_set_updated_at before update on public.external_schedule_sync for each row execute function public.set_updated_at();

alter table public.external_schedule_sync enable row level security;
drop policy if exists "public_select_all" on public.external_schedule_sync;
create policy "public_select_all" on public.external_schedule_sync for select to anon, authenticated using (true);
