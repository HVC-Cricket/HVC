-- =====================================================================
-- 2026-05-17 — Historical tournament MVP (CricHeroes-published)
-- ---------------------------------------------------------------------
-- HVC Seasons 1–6 were scored on CricHeroes. CricHeroes computes its
-- own MVP using a proprietary formula (fractional scores like 33.003).
-- We can't reconstruct it locally — and reusing our HVC formula on top
-- of historical aggregates produces only the team-bonus delta (everyone
-- on the champion side tied at 80 points, see issue raised 2026-05-17).
--
-- Instead we mirror cricheroes' published MVP leaderboard verbatim for
-- each imported tournament. New tournaments scored in our app continue
-- to compute MVP from `balls` via @/lib/scoring/mvp; historical
-- tournaments render from this table.
--
-- Source endpoint:
--   GET https://api.cricheroes.in/api/v1/mvp/get-tournament-player-mvp/:tid
--
-- Idempotent.
-- =====================================================================

create table if not exists historical_tournament_mvp (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references tournaments(id) on delete cascade,
  player_id       uuid references players(id) on delete set null,
  player_name     text not null,                       -- preserved if player row deleted
  team_id         uuid references teams(id) on delete set null,
  rank            smallint not null,
  matches         int not null default 0,
  batting_points  numeric not null default 0,
  bowling_points  numeric not null default 0,
  fielding_points numeric not null default 0,
  total_points    numeric not null,
  unique (tournament_id, player_id, player_name)
);

create index if not exists idx_historical_tournament_mvp_tournament_rank
  on historical_tournament_mvp (tournament_id, rank);

-- ---------------------------------------------------------------------
-- RLS: public read; writes via service-role only (one-shot import).
-- ---------------------------------------------------------------------
alter table historical_tournament_mvp enable row level security;

drop policy if exists "historical_tournament_mvp_select_public" on historical_tournament_mvp;
create policy "historical_tournament_mvp_select_public"
  on historical_tournament_mvp for select to public using (true);
