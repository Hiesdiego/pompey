-- Apply before enabling the Cup indexer. All amounts are raw 18-decimal TICK.
create table if not exists cup_prediction_events (
  chain_id bigint not null,
  pool_address text not null,
  tx_hash text not null,
  log_index integer not null,
  wallet_address text not null,
  market_kind text not null check (market_kind in ('match','spread','outright')),
  market_id bigint not null,
  outcome integer not null,
  amount_tick numeric(78,0) not null check (amount_tick > 0),
  primary key (chain_id, pool_address, tx_hash, log_index)
);
create index if not exists cup_prediction_market_idx on cup_prediction_events (chain_id, pool_address, market_kind, market_id);
create index if not exists cup_prediction_wallet_idx on cup_prediction_events (chain_id, pool_address, wallet_address);

create table if not exists cup_prediction_results (
  chain_id bigint not null,
  pool_address text not null,
  market_kind text not null check (market_kind in ('match','spread','outright')),
  market_id bigint not null,
  winning_outcome integer not null,
  primary key (chain_id, pool_address, market_kind, market_id)
);

create table if not exists cup_x_shares (
  chain_id bigint not null,
  pool_address text not null,
  wallet_address text not null,
  market_kind text not null,
  market_id bigint not null,
  post_url text not null,
  created_at timestamptz not null default now(),
  primary key (chain_id, pool_address, wallet_address, market_kind, market_id)
);
create unique index if not exists cup_x_shares_post_idx on cup_x_shares (chain_id, pool_address, post_url);

-- Explicit operator-managed adjustments. Positive or negative values can be
-- used to correct a wallet's displayed total without changing indexed activity.
create table if not exists cup_manual_points (
  chain_id bigint not null,
  pool_address text not null,
  wallet_address text not null,
  points bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (chain_id, pool_address, wallet_address)
);

-- One score per wallet and market. Repeated stakes increase size, never the
-- participation count. A market with multiple outcomes cannot earn conviction.
-- Start from every profile and LEFT JOIN scores so accounts without any Cup
-- activity remain on the leaderboard with zero points.
create or replace function cup_leaderboard(p_chain_id bigint, p_pool_address text, p_match_pool_address text)
returns table (wallet_address text, username text, points bigint, correct bigint, predictions bigint,
  stake_bonus bigint, conviction_bonus bigint, x_bonus bigint)
language sql stable security definer set search_path = public as $$
  with picks as (
    select e.wallet_address, e.pool_address, e.market_kind, e.market_id,
      sum(e.amount_tick) as total_stake,
      count(distinct e.outcome) as outcome_count,
      bool_or(e.outcome = r.winning_outcome) as won
    from cup_prediction_events e
    left join cup_prediction_results r on r.chain_id = e.chain_id and r.pool_address = e.pool_address
      and r.market_kind = e.market_kind and r.market_id = e.market_id
    where e.chain_id = p_chain_id and (e.pool_address = lower(p_pool_address)
      or (e.market_kind = 'match' and e.pool_address = lower(p_match_pool_address)))
    group by e.wallet_address, e.pool_address, e.market_kind, e.market_id
  ), ranked as (
    select p.*,
      rank() over (partition by pool_address, market_kind, market_id order by total_stake desc) as stake_rank,
      count(*) over (partition by pool_address, market_kind, market_id) as participants
    from picks p
  )
  select lower(pr.wallet_address)::text, pr.username::text,
    (count(p.market_id) + 5 * count(*) filter (where p.won)
      + 2 * count(*) filter (where p.stake_rank <= ceil(p.participants / 4.0))
      + count(*) filter (where p.outcome_count = 1 and p.total_stake >= 10 * 10^18)
      + count(s.post_url)
      + coalesce(max(mp.points), 0))::bigint as points,
    count(*) filter (where p.won)::bigint as correct,
    count(p.market_id)::bigint as predictions,
    (2 * count(*) filter (where p.stake_rank <= ceil(p.participants / 4.0)))::bigint as stake_bonus,
    count(*) filter (where p.outcome_count = 1 and p.total_stake >= 10 * 10^18)::bigint as conviction_bonus,
    count(s.post_url)::bigint as x_bonus
  from profiles pr
  left join ranked p on p.wallet_address = lower(pr.wallet_address)
  left join cup_x_shares s on s.chain_id = p_chain_id and s.pool_address = p.pool_address
    and s.wallet_address = p.wallet_address and s.market_kind = p.market_kind and s.market_id = p.market_id
  left join cup_manual_points mp on mp.chain_id = p_chain_id
    and mp.pool_address = lower(p_pool_address)
    and mp.wallet_address = lower(pr.wallet_address)
  group by pr.wallet_address, pr.username
  order by points desc, correct desc, predictions desc, pr.wallet_address;
$$;

alter table cup_prediction_events enable row level security;
alter table cup_prediction_results enable row level security;
alter table cup_x_shares enable row level security;
alter table cup_manual_points enable row level security;
revoke all on cup_prediction_events, cup_prediction_results, cup_x_shares, cup_manual_points from anon, authenticated;
revoke all on function cup_leaderboard(bigint,text,text) from public;
grant execute on function cup_leaderboard(bigint,text,text) to service_role;
