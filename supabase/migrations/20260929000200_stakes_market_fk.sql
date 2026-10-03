-- TICKR social layer — migration 002
-- Run once in the Supabase SQL editor (idempotent).
--
-- Adds the stakes → markets foreign key so PostgREST can embed the market
-- row inside stakes queries (used by GET /api/social/profiles/[username]/predictions
-- to filter by market state and return params/creatorName in one round trip).

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stakes_market_fk') then
    alter table stakes
      add constraint stakes_market_fk
      foreign key (chain_id, market_id)
      references markets (chain_id, market_id)
      on delete cascade;
  end if;
end
$$;
