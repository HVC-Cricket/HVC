-- =====================================================================
-- 2026-05-16 — Extend v_player_tournament_stats to include historical
-- ---------------------------------------------------------------------
-- Original view aggregated only from v_innings_batting / v_innings_bowling
-- (themselves derived from `balls`). Historical matches (CricHeroes
-- Seasons 1–6) have no `balls` rows, so career stats came out as zero
-- for every player who only ever played in those tournaments.
--
-- This view now UNION ALLs the ball-derived stats with aggregates
-- straight out of historical_match_batting / historical_match_bowling.
-- Same output columns, so every consumer (player page, /players list,
-- tournament Stats tab) picks up the historical numbers automatically.
--
-- Legal-ball conversion for bowling: cricheroes' `overs` is stored as
-- numeric "X.Y" where Y is the legal-balls-completed-in-the-last-over
-- (0..5). E.g. "5.3" = 5 overs + 3 balls = 33 legal balls. The
-- floor/fractional split below extracts both pieces correctly.
-- =====================================================================

create or replace view v_player_tournament_stats as
with ball_batting as (
  select
    m.tournament_id,
    vb.player_id,
    sum(vb.runs)        as runs,
    sum(vb.balls_faced) as balls_faced,
    sum(vb.fours)       as fours,
    sum(vb.sixes)       as sixes
  from v_innings_batting vb
  join innings i on i.id = vb.innings_id
  join matches m on m.id = i.match_id
  group by m.tournament_id, vb.player_id
),
hist_batting as (
  select
    m.tournament_id,
    hb.player_id,
    sum(hb.runs)        as runs,
    sum(hb.balls_faced) as balls_faced,
    sum(hb.fours)       as fours,
    sum(hb.sixes)       as sixes
  from historical_match_batting hb
  join matches m on m.id = hb.match_id
  where hb.player_id is not null
  group by m.tournament_id, hb.player_id
),
combined_batting as (
  select
    tournament_id, player_id,
    sum(runs)        as runs,
    sum(balls_faced) as balls_faced,
    sum(fours)       as fours,
    sum(sixes)       as sixes
  from (
    select * from ball_batting
    union all
    select * from hist_batting
  ) u
  group by tournament_id, player_id
),
ball_bowling as (
  select
    m.tournament_id,
    vbo.player_id,
    sum(vbo.wickets)            as wickets,
    sum(vbo.runs_conceded)      as runs_conceded,
    sum(vbo.legal_balls)        as legal_balls_bowled
  from v_innings_bowling vbo
  join innings i on i.id = vbo.innings_id
  join matches m on m.id = i.match_id
  group by m.tournament_id, vbo.player_id
),
hist_bowling as (
  select
    m.tournament_id,
    hw.player_id,
    sum(hw.wickets)        as wickets,
    sum(hw.runs)           as runs_conceded,
    sum(
      floor(hw.overs)::int * 6
      + ((hw.overs - floor(hw.overs)) * 10)::int
    )                       as legal_balls_bowled
  from historical_match_bowling hw
  join matches m on m.id = hw.match_id
  where hw.player_id is not null
  group by m.tournament_id, hw.player_id
),
combined_bowling as (
  select
    tournament_id, player_id,
    sum(wickets)            as wickets,
    sum(runs_conceded)      as runs_conceded,
    sum(legal_balls_bowled) as legal_balls_bowled
  from (
    select * from ball_bowling
    union all
    select * from hist_bowling
  ) u
  group by tournament_id, player_id
)
select
  t.id          as tournament_id,
  p.id          as player_id,
  p.display_name,
  coalesce(cb.runs, 0)                as runs,
  coalesce(cb.balls_faced, 0)         as balls_faced,
  coalesce(cb.fours, 0)               as fours,
  coalesce(cb.sixes, 0)               as sixes,
  coalesce(cbo.wickets, 0)            as wickets,
  coalesce(cbo.runs_conceded, 0)      as runs_conceded,
  coalesce(cbo.legal_balls_bowled, 0) as legal_balls_bowled
from tournaments t
cross join players p
left join combined_batting  cb  on cb.tournament_id  = t.id and cb.player_id  = p.id
left join combined_bowling  cbo on cbo.tournament_id = t.id and cbo.player_id = p.id;
