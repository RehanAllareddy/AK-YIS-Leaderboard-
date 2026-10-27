-- AK Young Investors Society Leaderboard — initial schema.
-- Applied by `npm run db:migrate`. Each migration runs inside a transaction.

-- Members ---------------------------------------------------------------
create table members (
  id              text primary key check (length(id) between 1 and 64),
  name            text not null check (length(name) between 1 and 200),
  score           integer not null,
  status          text not null default 'active' check (status in ('active', 'inactive')),
  -- Per-member point history carried over from the original JSON export
  -- (a list of +/- deltas with no timestamps). Kept verbatim; new changes
  -- are recorded in point_adjustments instead.
  legacy_history  integer[] not null default '{}',
  -- Optimistic-concurrency token. Every write bumps it; writers must send
  -- the version they read so stale updates are rejected.
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  imported_at     timestamptz
);

create index members_status_score_idx on members (status, score desc);

-- Administrators & sessions ---------------------------------------------
create table admins (
  id             integer generated always as identity primary key,
  username       text not null unique check (username = lower(username) and length(username) between 3 and 64),
  password_hash  text not null,
  display_name   text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

create table admin_sessions (
  -- SHA-256 of the session token; the raw token only ever lives in the
  -- user's httpOnly cookie.
  token_hash    text primary key,
  admin_id      integer not null references admins (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  ip            text,
  user_agent    text
);

create index admin_sessions_admin_idx on admin_sessions (admin_id);
create index admin_sessions_expires_idx on admin_sessions (expires_at);

create table login_attempts (
  id            integer generated always as identity primary key,
  key           text not null,
  attempted_at  timestamptz not null default now()
);

create index login_attempts_key_idx on login_attempts (key, attempted_at);

-- Audit -----------------------------------------------------------------
create table point_adjustments (
  id              integer generated always as identity primary key,
  member_id       text not null references members (id) on delete restrict,
  previous_score  integer not null,
  new_score       integer not null,
  delta           integer not null,
  kind            text not null check (kind in ('adjust', 'set', 'reset', 'import')),
  reason          text check (reason is null or length(reason) <= 500),
  admin_id        integer references admins (id) on delete set null,
  -- Snapshot so the record stays readable even if the admin is removed.
  admin_username  text not null,
  created_at      timestamptz not null default now(),
  check (new_score = previous_score + delta)
);

create index point_adjustments_member_idx on point_adjustments (member_id, created_at desc);
create index point_adjustments_created_idx on point_adjustments (created_at desc);

create table member_events (
  id              integer generated always as identity primary key,
  member_id       text not null references members (id) on delete restrict,
  action          text not null check (action in ('created', 'renamed', 'deactivated', 'reactivated', 'imported', 'import_updated')),
  details         jsonb not null default '{}'::jsonb,
  admin_id        integer references admins (id) on delete set null,
  admin_username  text not null,
  created_at      timestamptz not null default now()
);

create index member_events_created_idx on member_events (created_at desc);

-- Audit records are append-only.
create function reject_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit records are append-only';
end;
$$;

create trigger point_adjustments_append_only
  before update or delete on point_adjustments
  for each row execute function reject_audit_mutation();

create trigger member_events_append_only
  before update or delete on member_events
  for each row execute function reject_audit_mutation();

-- Settings & import runs ------------------------------------------------
create table app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table import_runs (
  id          integer generated always as identity primary key,
  source      text not null,
  sha256      text not null,
  mode        text not null,
  summary     jsonb not null,
  created_at  timestamptz not null default now()
);

-- Row Level Security ----------------------------------------------------
-- The app talks to Postgres only from the server, as the table owner, which
-- bypasses RLS. Enabling RLS with no policies means Supabase's public
-- `anon` / `authenticated` roles (used by its auto-generated REST API) can
-- neither read nor write anything.
alter table members           enable row level security;
alter table admins            enable row level security;
alter table admin_sessions    enable row level security;
alter table login_attempts    enable row level security;
alter table point_adjustments enable row level security;
alter table member_events     enable row level security;
alter table app_settings      enable row level security;
alter table import_runs       enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
  end if;
end;
$$;
