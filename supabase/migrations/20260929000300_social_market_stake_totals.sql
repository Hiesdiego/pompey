-- Aggregate profile market stake totals in Postgres rather than returning
-- every stake row to the Next.js server.

create or replace function public.social_market_stake_totals(
  p_chain_id integer,
  p_market_ids bigint[]
)
returns table (
  market_id bigint,
  total_staked_tick numeric,
  bettors bigint
)
language sql
stable
set search_path = public
as $$
  select
    s.market_id,
    coalesce(sum(s.amount_tick), 0)::numeric as total_staked_tick,
    count(distinct s.staker)::bigint as bettors
  from public.stakes as s
  where s.chain_id = p_chain_id
    and s.market_id = any(coalesce(p_market_ids, array[]::bigint[]))
  group by s.market_id;
$$;

revoke all on function public.social_market_stake_totals(integer, bigint[]) from public;
revoke all on function public.social_market_stake_totals(integer, bigint[]) from anon;
revoke all on function public.social_market_stake_totals(integer, bigint[]) from authenticated;
grant execute on function public.social_market_stake_totals(integer, bigint[]) to service_role;
