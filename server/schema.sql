-- Drippy ingest schema — Phase 1 (DATA-STORAGE.md).
-- Typed columns only; there is deliberately no free-text column that
-- could hold content. Apply once per database:
--   psql "$DATABASE_URL" -f schema.sql

create table if not exists workspaces (
  id uuid primary key,
  kind text not null check (kind in ('personal', 'org')),
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id),
  key_hash text not null unique,
  app_version text,
  os text,
  os_version text,
  factors_version text,
  country text,
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists rollups (
  device_id uuid not null references devices (id),
  date date not null,
  tz_offset_min int,
  requests int not null default 0,
  fg_requests int not null default 0,
  ai_seconds int not null default 0,
  wh real not null default 0,
  water_ml real not null default 0,
  gco2 real not null default 0,
  usd real not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  privacy_events int not null default 0,
  privacy_by_cat jsonb not null default '{}',
  apps jsonb not null default '{}',
  models jsonb not null default '{}',
  bytes_est_in bigint not null default 0,
  bytes_est_out bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (device_id, date)
);

create table if not exists events (
  id bigint generated always as identity primary key,
  device_id uuid not null references devices (id),
  hash text not null,
  ts timestamptz not null,
  kind text not null check (kind in ('request', 'privacy', 'notice')),
  app text,
  fg boolean,
  ms int,
  basis text check (basis in ('measured', 'estimated')),
  model text,
  tier smallint,
  tk jsonb,
  bytes jsonb,
  tokens_in bigint,
  tokens_out bigint,
  wh real,
  fv text,
  source text,
  cats jsonb,
  top_tier smallint,
  resolution text,
  ms_to_clear int,
  notice_id text,
  family text,
  received_at timestamptz not null default now(),
  unique (device_id, hash)
);

create index if not exists events_device_ts on events (device_id, ts);
