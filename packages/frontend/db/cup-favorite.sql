-- Run in the Supabase SQL editor before enabling the Cup favorite UI.
alter table public.profiles
  add column if not exists cup_favourite_team_id smallint
  check (cup_favourite_team_id between 0 and 63);
