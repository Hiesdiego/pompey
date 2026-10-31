create table if not exists cup_commentary_lines (
  id uuid primary key default gen_random_uuid(),
  match_id text not null,
  minute smallint not null check (minute between 0 and 60),
  voice text not null check (voice in ('professional', 'witty')),
  text text not null check (char_length(text) <= 280),
  event_type text not null,
  event_id text not null unique,
  tokens_used integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cup_commentary_lines_match_idx on cup_commentary_lines (match_id, created_at);
alter table cup_commentary_lines enable row level security;
