-- =====================================================================
-- Seed match results for "Pav's tournament" round-robin (matches 2..21)
-- ---------------------------------------------------------------------
-- Scoring for match #1 is already done manually, so this script only
-- touches scheduled group-stage matches — match 1 is already completed
-- and skipped naturally via `status = 'scheduled'`.
--
-- Source: C:\Users\panee\Downloads\Book2.xlsx
--   col A : batting-first team      col D : batting-second team
--   col B : R/W (1st innings)       col E : R/W (2nd innings)
--   col C : overs (1st innings)     col F : overs (2nd innings)
--
-- Overs converted to legal_balls via cricket notation:
--   X.Y  =>  X*6 + Y     e.g. 5.4 overs = 34 legal balls
--
-- Team-name spelling note: the Excel uses "Rashtrakoota" but
-- seed-test-2-teams.sql uses "Rashtrakuta". This script uses
-- "Rashtrakuta" — change to "Rashtrakoota" below if Pav's tournament
-- was seeded with the other spelling.
--
-- Per match the script:
--   1. Marks the match completed, sets winner / margin / toss.
--   2. Inserts innings 1 (batting-first team) and innings 2 (chaser)
--      with total_runs, total_wickets, total_legal_balls.
-- That's enough for v_points_table (W/L/Pts) AND for the standings
-- page's NRR calculation, which reads innings rows directly.
-- =====================================================================

BEGIN;

WITH
  tournament AS (
    SELECT id FROM tournaments WHERE name = 'Pav''s tournament' LIMIT 1
  ),

  -- 20 result rows. Column A team in Excel batted first in every match.
  results (
    bat1_name,                  bat1_runs, bat1_wkts, bat1_balls,
    bat2_name,                  bat2_runs, bat2_wkts, bat2_balls
  ) AS (
    VALUES
      ('Chalukya Chakravartis',      40, 5, 36,  'Vijayanagara Royals',      41, 2, 24),
      ('Rashtrakuta Ranadheeras',    90, 3, 42,  'Glorious Gangas',          85, 5, 42),
      ('Chalukya Chakravartis',      87, 4, 42,  'Kadamba Warriors',         75, 5, 42),
      ('Hoysala Hunters',            94, 4, 36,  'Vijayanagara Royals',      98, 4, 34),
      ('Wodeyars The Kings',        102, 4, 42,  'Glorious Gangas',          56, 7, 42),
      ('Rashtrakuta Ranadheeras',    78, 6, 42,  'Kadamba Warriors',         80, 2, 40),
      ('Chalukya Chakravartis',      84, 3, 42,  'Wodeyars The Kings',       74, 7, 37),
      ('Hoysala Hunters',            74, 7, 40,  'Rashtrakuta Ranadheeras',  75, 3, 37),
      ('Vijayanagara Royals',        78, 2, 42,  'Kadamba Warriors',         46, 7, 40),
      ('Rashtrakuta Ranadheeras',    89, 4, 42,  'Chalukya Chakravartis',    45, 5, 42),
      ('Wodeyars The Kings',         75, 4, 36,  'Vijayanagara Royals',      65, 5, 42),
      ('Glorious Gangas',           118, 2, 42,  'Kadamba Warriors',         78, 2, 42),
      ('Rashtrakuta Ranadheeras',    59, 4, 42,  'Wodeyars The Kings',       60, 3, 36),
      ('Chalukya Chakravartis',      78, 5, 42,  'Glorious Gangas',          79, 4, 34),
      ('Hoysala Hunters',           103, 6, 42,  'Kadamba Warriors',         68, 4, 42),
      ('Vijayanagara Royals',        84, 4, 36,  'Glorious Gangas',          78, 5, 36),
      ('Hoysala Hunters',            79, 5, 42,  'Wodeyars The Kings',       80, 4, 40),
      ('Rashtrakuta Ranadheeras',    78, 4, 36,  'Vijayanagara Royals',      77, 5, 36),
      ('Chalukya Chakravartis',      85, 4, 42,  'Hoysala Hunters',          76, 7, 38),
      ('Wodeyars The Kings',        100, 4, 42,  'Kadamba Warriors',         94, 5, 42)
  ),

  -- Resolve each row to its match by team pair (either order on the match row).
  resolved AS (
    SELECT
      m.id                                                              AS match_id,
      ta.id                                                             AS bat1_team_id,
      tb.id                                                             AS bat2_team_id,
      r.bat1_runs, r.bat1_wkts, r.bat1_balls,
      r.bat2_runs, r.bat2_wkts, r.bat2_balls,
      CASE WHEN r.bat1_runs > r.bat2_runs THEN ta.id ELSE tb.id END     AS winner_id,
      CASE
        WHEN r.bat1_runs > r.bat2_runs
          THEN 'won by ' || (r.bat1_runs - r.bat2_runs) || ' runs'
        ELSE 'won by ' || (m.players_per_side - r.bat2_wkts) || ' wickets'
      END                                                               AS win_margin
    FROM results r
    JOIN teams ta
      ON ta.tournament_id = (SELECT id FROM tournament)
     AND ta.name = r.bat1_name
    JOIN teams tb
      ON tb.tournament_id = (SELECT id FROM tournament)
     AND tb.name = r.bat2_name
    JOIN matches m
      ON m.tournament_id = (SELECT id FROM tournament)
     AND m.stage  = 'group'
     AND m.status = 'scheduled'
     AND (
           (m.team_a_id = ta.id AND m.team_b_id = tb.id)
        OR (m.team_a_id = tb.id AND m.team_b_id = ta.id)
     )
  ),

  updated_matches AS (
    UPDATE matches m
    SET
      status         = 'completed',
      result_type    = 'normal',
      winner_id      = r.winner_id,
      win_margin     = r.win_margin,
      toss_winner_id = r.bat1_team_id,
      toss_decision  = 'bat',
      started_at     = COALESCE(m.started_at, now() - interval '2 hours'),
      ended_at       = now() - interval '1 hour'
    FROM resolved r
    WHERE m.id = r.match_id
    RETURNING m.id
  ),

  innings1 AS (
    INSERT INTO innings (
      match_id, innings_number,
      batting_team_id, bowling_team_id,
      total_runs, total_wickets, total_legal_balls,
      target, is_complete, started_at, ended_at
    )
    SELECT
      r.match_id, 1,
      r.bat1_team_id, r.bat2_team_id,
      r.bat1_runs, r.bat1_wkts, r.bat1_balls,
      NULL, true,
      now() - interval '2 hours', now() - interval '1 hour 30 minutes'
    FROM resolved r
    RETURNING match_id
  ),

  innings2 AS (
    INSERT INTO innings (
      match_id, innings_number,
      batting_team_id, bowling_team_id,
      total_runs, total_wickets, total_legal_balls,
      target, is_complete, started_at, ended_at
    )
    SELECT
      r.match_id, 2,
      r.bat2_team_id, r.bat1_team_id,
      r.bat2_runs, r.bat2_wkts, r.bat2_balls,
      r.bat1_runs + 1, true,
      now() - interval '1 hour 30 minutes', now() - interval '1 hour'
    FROM resolved r
    RETURNING match_id
  )

SELECT
  (SELECT count(*) FROM updated_matches) AS matches_completed,
  (SELECT count(*) FROM innings1)        AS innings1_inserted,
  (SELECT count(*) FROM innings2)        AS innings2_inserted;

COMMIT;
