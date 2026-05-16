-- =====================================================================
-- 2026-05-16 — Historical match aggregates (CricHeroes-imported matches)
-- ---------------------------------------------------------------------
-- HVC Seasons 1–6 were scored on CricHeroes, not our app. CricHeroes
-- does NOT expose complete ball-by-ball for these matches (commentary
-- feed is missing real dismissals + wide/no-ball penalties), so we
-- can't reconstruct the `balls` table. Instead we ship three tables
-- holding the per-innings aggregates we DID scrape: per-batter line,
-- per-bowler line, fall-of-wickets.
--
-- The spectator UI falls back to these tables for any match where
-- `balls` is empty. New matches scored in our app continue to derive
-- stats from `balls` and ignore these tables.
--
-- Idempotent.
-- =====================================================================

create table if not exists historical_match_batting (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null references matches(id) on delete cascade,
  innings_number    smallint not null,
  batting_team_id   uuid not null references teams(id) on delete cascade,
  player_id         uuid references players(id) on delete set null,
  player_name       text not null,                       -- preserved even if player row deleted
  batting_order     smallint,
  is_captain        boolean not null default false,
  runs              int not null default 0,
  balls_faced       int not null default 0,
  minutes           int,
  fours             int not null default 0,
  sixes             int not null default 0,
  strike_rate       numeric,
  batting_hand      text,
  how_to_out        text,
  is_out            boolean not null default false,
  unique (match_id, innings_number, player_id)
);

create table if not exists historical_match_bowling (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null references matches(id) on delete cascade,
  innings_number    smallint not null,
  bowling_team_id   uuid not null references teams(id) on delete cascade,
  player_id         uuid references players(id) on delete set null,
  player_name       text not null,
  bowling_order     smallint,
  overs             numeric not null default 0,
  maidens           int not null default 0,
  runs              int not null default 0,
  wickets           int not null default 0,
  dots              int not null default 0,
  fours_conceded    int not null default 0,
  sixes_conceded    int not null default 0,
  wides             int not null default 0,
  noballs           int not null default 0,
  economy_rate      numeric,
  unique (match_id, innings_number, player_id)
);

create table if not exists historical_match_fall_of_wickets (
  id                  uuid primary key default gen_random_uuid(),
  match_id            uuid not null references matches(id) on delete cascade,
  innings_number      smallint not null,
  batting_team_id     uuid not null references teams(id) on delete cascade,
  wicket_no           smallint not null,
  run_at_fall         int not null,
  over_at_fall        numeric,
  dismiss_player_id   uuid references players(id) on delete set null,
  dismiss_player_name text,
  unique (match_id, innings_number, wicket_no)
);

create index if not exists idx_historical_batting_match
  on historical_match_batting (match_id, innings_number, batting_order);
create index if not exists idx_historical_bowling_match
  on historical_match_bowling (match_id, innings_number, bowling_order);
create index if not exists idx_historical_fow_match
  on historical_match_fall_of_wickets (match_id, innings_number, wicket_no);

-- ---------------------------------------------------------------------
-- RLS: public read; writes via service-role only (no organizer flow
-- exists — this is one-time imported data).
-- ---------------------------------------------------------------------
alter table historical_match_batting          enable row level security;
alter table historical_match_bowling          enable row level security;
alter table historical_match_fall_of_wickets  enable row level security;

drop policy if exists "historical_batting_select_public" on historical_match_batting;
create policy "historical_batting_select_public"
  on historical_match_batting for select to public using (true);

drop policy if exists "historical_bowling_select_public" on historical_match_bowling;
create policy "historical_bowling_select_public"
  on historical_match_bowling for select to public using (true);

drop policy if exists "historical_fow_select_public" on historical_match_fall_of_wickets;
create policy "historical_fow_select_public"
  on historical_match_fall_of_wickets for select to public using (true);
