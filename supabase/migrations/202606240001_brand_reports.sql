create table if not exists public.brand_reports (
  id text primary key,
  file_name text not null unique,
  brand jsonb not null default '{}'::jsonb,
  html text not null,
  deleted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value text,
  is_secret boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists brand_reports_deleted_created_idx
  on public.brand_reports (deleted_at, created_at desc);

alter table public.brand_reports enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.brand_reports from anon, authenticated;
revoke all on public.app_settings from anon, authenticated;

grant select, insert, update, delete on public.brand_reports to service_role;
grant select, insert, update, delete on public.app_settings to service_role;
