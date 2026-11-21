-- TICKR Stock Meme Arena, Supabase schema.
--
-- Destination in the repo: packages/backend/sql/arena-schema.sql,
-- alongside packages/backend/sql/cup-commentary.sql (the file that
-- defines cup_commentary_lines; the repo has no
-- packages/backend/supabase/ directory, so the arena schema follows
-- the cup commentary pattern, not a supabase/ folder).
--
-- Access pattern, identical to cup_commentary_lines: row level
-- security is ENABLED on every table with NO public policies, so
-- only the backend's service-role client (lib/supabase.ts,
-- createSocialDb) can read or write. Run this file once in the
-- Supabase SQL editor (or as a migration) BEFORE starting the arena
-- services; the registry, keeper, cup service, ratings and
-- commentary all degrade or idle without their tables.
--
-- Tables:
--   arena_cups               one row per weekly cup (week_key unique)
--   arena_cup_ties           bracket ties, seeds, clash ids, winners
--   arena_ratings            one Elo row per meme (cup matches only)
--   arena_rating_history     append-only rating audit + appearances
--   arena_volume_snapshots   daily registry volume/liquidity per meme
--   arena_clash_snapshots    keeper start/end prices per clash
--   arena_featured_clashes   featured clash flags (managed out of band)
--   arena_commentary_lines   append-only commentary (SF/F + featured)

create table if not exists arena_cups (
  id uuid primary key default gen_random_uuid(),
  week_key text not null unique,
  status text not null check (status in ('live', 'completed', 'skipped')),
  bracket_size integer,
  field_size integer,
  champion text,
  champion_symbol text,
  runner_up text,
  runner_up_symbol text,
  seeded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists arena_cups_week_idx on arena_cups (week_key desc);
alter table arena_cups enable row level security;

create table if not exists arena_cup_ties (
  id uuid primary key default gen_random_uuid(),
  cup_id uuid not null references arena_cups (id),
  round text not null check (round in ('R32', 'R16', 'QF', 'SF', 'F')),
  tie_index integer not null,
  seed_a integer,
  seed_b integer,
  meme_a text,
  meme_b text,
  symbol_a text,
  symbol_b text,
  clash_id bigint,
  status text not null check (status in ('pending', 'live', 'won', 'bye', 'void_replay', 'advanced_double_void')),
  winner text,
  replays integer not null default 0,
  created_at timestamptz not null default now(),
  unique (cup_id, round, tie_index)
);
create index if not exists arena_cup_ties_cup_idx on arena_cup_ties (cup_id, round, tie_index);
create index if not exists arena_cup_ties_clash_idx on arena_cup_ties (clash_id);
alter table arena_cup_ties enable row level security;

create table if not exists arena_ratings (
  address text primary key,
  symbol text not null,
  points double precision not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  appearances integer not null default 0,
  first_appearance_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists arena_ratings_points_idx on arena_ratings (points desc);
alter table arena_ratings enable row level security;

create table if not exists arena_rating_history (
  id uuid primary key default gen_random_uuid(),
  cup_id uuid,
  clash_id bigint,
  round text,
  kind text not null check (kind in ('appearance', 'result')),
  meme_address text not null,
  opponent_address text,
  delta double precision not null default 0,
  points_after double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists arena_rating_history_meme_idx on arena_rating_history (meme_address, created_at);
create index if not exists arena_rating_history_cup_idx on arena_rating_history (cup_id, kind, meme_address);
alter table arena_rating_history enable row level security;

create table if not exists arena_volume_snapshots (
  address text not null,
  day date not null,
  volume24h_usd double precision not null default 0,
  liquidity_usd double precision not null default 0,
  created_at timestamptz not null default now(),
  primary key (address, day)
);
create index if not exists arena_volume_snapshots_day_idx on arena_volume_snapshots (day desc);
alter table arena_volume_snapshots enable row level security;

create table if not exists arena_clash_snapshots (
  clash_id bigint not null,
  phase text not null check (phase in ('start', 'end')),
  meme_price text not null,
  opp_price text not null,
  meme_volume24h_usd double precision,
  opp_volume24h_usd double precision,
  captured_at timestamptz not null default now(),
  primary key (clash_id, phase)
);
alter table arena_clash_snapshots enable row level security;

create table if not exists arena_featured_clashes (
  clash_id bigint primary key,
  note text,
  created_at timestamptz not null default now()
);
alter table arena_featured_clashes enable row level security;

create table if not exists arena_commentary_lines (
  id uuid primary key default gen_random_uuid(),
  clash_id bigint not null,
  voice text not null check (voice in ('professional', 'witty', 'analytics')),
  kind text not null check (kind in ('window_start', 'lead_change', 'goal', 'window_end')),
  line text not null check (char_length(line) <= 700),
  event_id text not null unique,
  tokens_used integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists arena_commentary_lines_clash_idx on arena_commentary_lines (clash_id, created_at);
alter table arena_commentary_lines enable row level security;
