-- =====================================================================
-- Undo for seed-pavs-tournament-results.sql
-- ---------------------------------------------------------------------
-- Deletes innings rows and resets matches back to 'scheduled' for every
-- group-stage match in "Pav's tournament" — INCLUDING match #1. If you
-- want to preserve the manually-scored match #1, run only the targeted
-- form at the bottom of this file instead of the bulk block.
-- =====================================================================

BEGIN;

-- Bulk reset: every group match in the tournament.
DELETE FROM innings
WHERE match_id IN (
  SELECT m.id FROM matches m
  JOIN tournaments t ON t.id = m.tournament_id
  WHERE t.name = 'Pav''s tournament' AND m.stage = 'group'
);

UPDATE matches AS m
SET status         = 'scheduled',
    result_type    = NULL,
    winner_id      = NULL,
    win_margin     = NULL,
    toss_winner_id = NULL,
    toss_decision  = NULL,
    started_at     = NULL,
    ended_at       = NULL
FROM tournaments t
WHERE m.tournament_id = t.id
  AND t.name = 'Pav''s tournament'
  AND m.stage = 'group';

COMMIT;

-- ---------------------------------------------------------------------
-- Safer alternative: skip match #1 (already manually scored).
-- Comment out the bulk block above and uncomment the block below.
-- ---------------------------------------------------------------------
-- BEGIN;
--
-- DELETE FROM innings
-- WHERE match_id IN (
--   SELECT m.id FROM matches m
--   JOIN tournaments t ON t.id = m.tournament_id
--   WHERE t.name = 'Pav''s tournament'
--     AND m.stage = 'group'
--     AND m.match_number > 1
-- );
--
-- UPDATE matches AS m
-- SET status         = 'scheduled',
--     result_type    = NULL,
--     winner_id      = NULL,
--     win_margin     = NULL,
--     toss_winner_id = NULL,
--     toss_decision  = NULL,
--     started_at     = NULL,
--     ended_at       = NULL
-- FROM tournaments t
-- WHERE m.tournament_id = t.id
--   AND t.name = 'Pav''s tournament'
--   AND m.stage = 'group'
--   AND m.match_number > 1;
--
-- COMMIT;
