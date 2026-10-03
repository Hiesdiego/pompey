-- TICKR social layer — migration 001
-- Run once in the Supabase SQL editor (idempotent).
-- All access goes through the backend with the SERVICE ROLE key;
-- RLS is enabled with no public policies (service role bypasses RLS).

-- ---------------------------------------------------------------- profiles
create table if not exists profiles (
  wallet_address text primary key,                 -- lowercase 0x hex (playerAddress)
  username text not null,                          -- canonical lowercase
  username_set_season integer not null,            -- season id when claimed/last changed
  favourite_team_id integer not null,              -- 0..19 coin team id
  favourite_team_set_season integer not null,
  bio text not null default '' check (char_length(bio) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_unique
  on profiles (username);
alter table profiles enable row level security;

-- ---------------------------------------------------------------- markets
-- Mirror of MarketFactory MarketCreated + settlement state.
create table if not exists markets (
  chain_id integer not null,
  market_id bigint not null,
  template_id smallint not null,                  -- 0..4 TOP_GAINER..SPREAD
  creator text not null,                           -- lowercase wallet
  creator_name text not null,                      -- as written on-chain (max 32)
  params text not null,                            -- 0x hex of abi-encoded params
  betting_close_time timestamptz not null,
  end_time timestamptz not null,
  seed_amount_tick numeric not null,
  state text not null default 'open' check (state in ('open','resolved','voided')),
  winner_bitmap numeric,
  payout_per_share numeric,                        -- 1e18 = 1.0
  resolved_at timestamptz,
  season_id integer,                               -- null when template carries none
  created_at timestamptz not null default now(),
  primary key (chain_id, market_id)
);
create index if not exists markets_creator_idx on markets (creator);
create index if not exists markets_state_idx on markets (state);
alter table markets enable row level security;

-- ---------------------------------------------------------------- stakes
-- One row per MarketStaked event. pnl_tick / won filled at resolve time.
create table if not exists stakes (
  id bigint generated always as identity primary key,
  chain_id integer not null,
  market_id bigint not null,
  staker text not null,                            -- lowercase wallet
  outcome integer not null,
  amount_tick numeric not null,                    -- 18-decimal exact
  odds_bps integer,                                -- implied win prob (bps) of the
                                                   -- chosen outcome right after the
                                                   -- stake; null when unavailable
                                                   -- (e.g. historical backfill)
  pnl_tick numeric,                                -- realized at resolve; null until then
  won boolean,                                     -- null until resolved; null on void
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  block_timestamp timestamptz not null,
  season_id integer,
  template_id smallint,
  created_at timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index)
);
create index if not exists stakes_staker_idx on stakes (staker, block_timestamp desc);
create index if not exists stakes_market_idx on stakes (chain_id, market_id);
alter table stakes enable row level security;

-- ------------------------------------------------------- user_season_stats
-- Leaderboard aggregates, maintained by the indexer. One row per wallet/season.
create table if not exists user_season_stats (
  wallet_address text not null,                    -- lowercase wallet
  season_id integer not null,
  volume_tick numeric not null default 0,          -- total staked
  predictions integer not null default 0,          -- distinct markets staked
  settled integer not null default 0,              -- resolved (non-void) predictions
  wins integer not null default 0,
  losses integer not null default 0,
  pnl_tick numeric not null default 0,             -- realized, incl. seed subsidy share
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (wallet_address, season_id)
);
create index if not exists user_season_stats_pnl_idx
  on user_season_stats (season_id, pnl_tick desc);
alter table user_season_stats enable row level security;

-- ------------------------------------------------------- indexer_state
-- High-water mark so the indexer resumes after restarts.
create table if not exists indexer_state (
  key text primary key,
  last_block bigint not null,
  updated_at timestamptz not null default now()
);
alter table indexer_state enable row level security;
