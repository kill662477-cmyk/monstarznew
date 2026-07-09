-- MONSTARZNEW admin audit log.
-- Server admin API writes here with the service role key after create/update/hide/restore/pin/reorder actions.
-- Public clients cannot read or write audit rows.

create extension if not exists "pgcrypto";

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  resource_key text not null,
  table_name text,
  row_id text,
  payload jsonb not null default '{}'::jsonb,
  user_agent text,
  ip_hash text,
  created_at timestamptz default now()
);

create index if not exists idx_admin_audit_created on public.admin_audit_log (created_at desc);
create index if not exists idx_admin_audit_resource on public.admin_audit_log (resource_key, created_at desc);
create index if not exists idx_admin_audit_row on public.admin_audit_log (row_id);

alter table public.admin_audit_log enable row level security;
drop policy if exists "no_public_admin_audit" on public.admin_audit_log;
create policy "no_public_admin_audit" on public.admin_audit_log for select to anon, authenticated using (false);
