-- =====================================================================
-- One-off seed: 21 group-stage matches for "Test 2"
-- ---------------------------------------------------------------------
-- Run via Supabase Dashboard → SQL Editor, or:
--   pnpm exec supabase db query --linked --file scripts/seed-test-2-matches.sql
--
-- For every match:
--   stage              = 'group'
--   overs_per_innings  = 7
--   players_per_side   = 7
--   scheduled_at       = NULL (set per match via the edit UI when known)
--   venue              = NULL
-- match_number starts at the tournament's current max + 1, so re-running
-- after some matches already exist won't collide on the
-- (tournament_id, match_number) unique constraint.
--
-- Team name spelling matches the seed-test-2-teams.sql script
-- ("Rashtrakuta Ranadheeras", not "Rashtrakoota"). If your DB uses a
-- different spelling, edit those rows in the schedule CTE below.
-- =====================================================================

BEGIN;

WITH
  -- 1. Resolve the tournament.
  tournament AS (
    SELECT id FROM tournaments WHERE name = 'Test 2' LIMIT 1
  ),

  -- 2. Test 2's teams.
  test2_teams AS (
    SELECT id, name
    FROM teams
    WHERE tournament_id = (SELECT id FROM tournament)
  ),

  -- 3. Offset for match_number — picks up after any matches that already
  --    exist in this tournament so we don't violate the unique key.
  next_match_number AS (
    SELECT COALESCE(MAX(match_number), 0) AS n
    FROM matches
    WHERE tournament_id = (SELECT id FROM tournament)
  ),

  -- 4. Hand-typed schedule (row order = match order).
  schedule (seq, team_a_name, team_b_name) AS (
    VALUES
      ( 1, 'Hoysala Hunters',        'Glorious Gangas'),
      ( 2, 'Chalukya Chakravartis',  'Vijayanagara Royals'),
      ( 3, 'Rashtrakuta Ranadheeras','Glorious Gangas'),
      ( 4, 'Chalukya Chakravartis',  'Kadamba Warriors'),
      ( 5, 'Hoysala Hunters',        'Vijayanagara Royals'),
      ( 6, 'Wodeyars The Kings',     'Glorious Gangas'),
      ( 7, 'Rashtrakuta Ranadheeras','Kadamba Warriors'),
      ( 8, 'Chalukya Chakravartis',  'Wodeyars The Kings'),
      ( 9, 'Hoysala Hunters',        'Rashtrakuta Ranadheeras'),
      (10, 'Vijayanagara Royals',    'Kadamba Warriors'),
      (11, 'Rashtrakuta Ranadheeras','Chalukya Chakravartis'),
      (12, 'Wodeyars The Kings',     'Vijayanagara Royals'),
      (13, 'Glorious Gangas',        'Kadamba Warriors'),
      (14, 'Rashtrakuta Ranadheeras','Wodeyars The Kings'),
      (15, 'Chalukya Chakravartis',  'Glorious Gangas'),
      (16, 'Hoysala Hunters',        'Kadamba Warriors'),
      (17, 'Vijayanagara Royals',    'Glorious Gangas'),
      (18, 'Hoysala Hunters',        'Wodeyars The Kings'),
      (19, 'Rashtrakuta Ranadheeras','Vijayanagara Royals'),
      (20, 'Chalukya Chakravartis',  'Hoysala Hunters'),
      (21, 'Wodeyars The Kings',     'Kadamba Warriors')
  )

INSERT INTO matches (
  tournament_id,
  match_number,
  stage,
  team_a_id,
  team_b_id,
  overs_per_innings,
  players_per_side
)
SELECT
  t.id,
  nmn.n + s.seq,
  'group',
  ta.id,
  tb.id,
  7,
  7
FROM schedule s
CROSS JOIN tournament t
CROSS JOIN next_match_number nmn
JOIN test2_teams ta ON ta.name = s.team_a_name
JOIN test2_teams tb ON tb.name = s.team_b_name
ORDER BY s.seq;

COMMIT;
