-- =====================================================================
-- Seed: HVC Season 7 schedule — 21 round-robin matches across 7 teams.
-- Source: C:\Users\panee\Downloads\HVC_Schedule_Final.xlsx (sheet
-- "Sheet9 (2)").
--
-- Pre-conditions (must already exist on the target project):
--   - tournaments.name = 'HVC - SEASON 7'
--   - 7 teams under that tournament with the names below
--
-- Run:
--   pnpm exec supabase db query --linked --file scripts/seed-hvc-season-7-schedule.sql
--
-- One-shot only — re-running will duplicate matches because
-- `match_number` isn't unique per tournament at the schema level.
-- =====================================================================

BEGIN;

WITH
  tournament AS (
    SELECT id FROM tournaments WHERE name = 'HVC - SEASON 7' LIMIT 1
  ),
  -- Each schedule row carries the two team names + the start of the
  -- 30-min slot from the Excel (IST). Match numbers run 1..21 in the
  -- listed order — match 1 is the first slot of day 1.
  schedule (seq, scheduled_at, team_a_name, team_b_name) AS (
    VALUES
      ( 1, timestamptz '2026-05-23 14:00+05:30', 'Chalukya Chakravartis',   'Wodeyars The Kings'),
      ( 2, timestamptz '2026-05-23 14:40+05:30', 'Hoysala Hunters',         'Rashtrakoota Ranadheeras'),
      ( 3, timestamptz '2026-05-23 15:20+05:30', 'Glorious Gangas',         'Vijayanagara Royals'),
      ( 4, timestamptz '2026-05-23 16:00+05:30', 'Hoysala Hunters',         'Kadamba Warriors'),
      ( 5, timestamptz '2026-05-23 16:40+05:30', 'Rashtrakoota Ranadheeras','Glorious Gangas'),
      ( 6, timestamptz '2026-05-23 17:20+05:30', 'Vijayanagara Royals',     'Kadamba Warriors'),
      ( 7, timestamptz '2026-05-23 18:00+05:30', 'Chalukya Chakravartis',   'Hoysala Hunters'),
      ( 8, timestamptz '2026-05-23 18:40+05:30', 'Wodeyars The Kings',      'Glorious Gangas'),
      ( 9, timestamptz '2026-05-23 19:20+05:30', 'Rashtrakoota Ranadheeras','Vijayanagara Royals'),
      (10, timestamptz '2026-05-23 20:00+05:30', 'Chalukya Chakravartis',   'Kadamba Warriors'),
      (11, timestamptz '2026-05-23 20:40+05:30', 'Hoysala Hunters',         'Wodeyars The Kings'),
      (12, timestamptz '2026-05-23 21:20+05:30', 'Chalukya Chakravartis',   'Rashtrakoota Ranadheeras'),
      (13, timestamptz '2026-05-23 22:00+05:30', 'Glorious Gangas',         'Kadamba Warriors'),
      (14, timestamptz '2026-05-24 12:00+05:30', 'Chalukya Chakravartis',   'Vijayanagara Royals'),
      (15, timestamptz '2026-05-24 12:40+05:30', 'Wodeyars The Kings',      'Kadamba Warriors'),
      (16, timestamptz '2026-05-24 13:20+05:30', 'Glorious Gangas',         'Chalukya Chakravartis'),
      (17, timestamptz '2026-05-24 14:00+05:30', 'Hoysala Hunters',         'Vijayanagara Royals'),
      (18, timestamptz '2026-05-24 14:40+05:30', 'Rashtrakoota Ranadheeras','Kadamba Warriors'),
      (19, timestamptz '2026-05-24 15:20+05:30', 'Wodeyars The Kings',      'Vijayanagara Royals'),
      (20, timestamptz '2026-05-24 16:00+05:30', 'Hoysala Hunters',         'Glorious Gangas'),
      (21, timestamptz '2026-05-24 16:40+05:30', 'Rashtrakoota Ranadheeras','Wodeyars The Kings')
  ),
  -- Resolve team IDs by joining the schedule against the existing
  -- teams under this tournament — case-insensitive on `name` so a
  -- stray casing nit in the Excel doesn't break the insert.
  resolved AS (
    SELECT
      s.seq,
      s.scheduled_at,
      ta.id AS team_a_id,
      tb.id AS team_b_id
    FROM schedule s
    CROSS JOIN tournament t
    JOIN teams ta
      ON ta.tournament_id = t.id
     AND lower(ta.name) = lower(s.team_a_name)
    JOIN teams tb
      ON tb.tournament_id = t.id
     AND lower(tb.name) = lower(s.team_b_name)
  )
INSERT INTO matches (
  tournament_id,
  match_number,
  stage,
  team_a_id,
  team_b_id,
  overs_per_innings,
  players_per_side,
  scheduled_at,
  venue
)
SELECT
  t.id,
  r.seq,
  'group',
  r.team_a_id,
  r.team_b_id,
  7,                  -- HVC default: 7 overs per innings
  7,                  -- HVC default: 7 players per side
  r.scheduled_at,
  'Bengaluru'
FROM resolved r
CROSS JOIN tournament t
ORDER BY r.seq;

-- Sanity-check: confirm we inserted 21 rows. CTEs only scope to the
-- statement they're declared in, so the lookup is repeated inline
-- rather than referencing the `tournament` CTE above. If the count is
-- off (e.g. a team name didn't match), abort the transaction by hand
-- before the COMMIT.
SELECT count(*) AS group_matches_total
FROM matches m
JOIN tournaments t ON t.id = m.tournament_id
WHERE t.name = 'HVC - SEASON 7'
  AND m.stage = 'group';

COMMIT;
