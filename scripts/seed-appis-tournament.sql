-- =====================================================================
-- Seed: 4 teams + 28 players + 6 round-robin matches for "Appi's tournament"
-- Format = round_robin_playoff_final, so the playoffs (Q1 / Eliminator /
-- Q2 / Final) auto-schedule via maybeAutoSchedulePlayoffs once all group
-- matches go terminal. Targets dev project (clqdimzthzcpurtwhtej).
--
--   pnpm exec supabase db query --linked --file scripts/seed-appis-tournament.sql
--
-- One-shot only — re-running will duplicate teams + players + fixtures.
-- =====================================================================

BEGIN;

WITH
  tournament AS (
    SELECT id FROM tournaments WHERE slug = 'appis-tournament' LIMIT 1
  ),
  new_teams AS (
    INSERT INTO teams (tournament_id, name, short_name)
    SELECT t.id, v.name, v.short_name
    FROM tournament t
    CROSS JOIN (VALUES
      ('Royal Strikers',  'RS'),
      ('Storm Riders',    'SR'),
      ('Phoenix Flames',  'PF'),
      ('Silver Sharks',   'SS')
    ) v(name, short_name)
    RETURNING id, name
  ),
  -- One Cat 1 + one Cat 3 per team so the special-over rules
  -- (Cat-1-must-face-Cat-1, Cat-1/3 repeat dismissal, etc.) are
  -- testable end-to-end. Remaining 5 per team are Cat 2.
  new_players AS (
    INSERT INTO players (display_name, batting_style, bowling_style, category)
    VALUES
      -- Royal Strikers
      ('Arjun',   'right_hand', 'right_arm_fast',   1),
      ('Vikram',  'right_hand', 'right_arm_fast',   3),
      ('Rohit',   'left_hand',  'right_arm_medium', 2),
      ('Surya',   'right_hand', 'right_arm_fast',   2),
      ('Karan',   'right_hand', 'right_arm_medium', 2),
      ('Pranav',  'right_hand', 'right_arm_spin',   2),
      ('Ishan',   'left_hand',  'right_arm_fast',   2),
      -- Storm Riders
      ('Sachin',  'right_hand', 'right_arm_fast',   1),
      ('Rahul',   'right_hand', 'right_arm_medium', 3),
      ('Yash',    'right_hand', 'right_arm_fast',   2),
      ('Dev',     'left_hand',  'right_arm_spin',   2),
      ('Aman',    'right_hand', 'right_arm_fast',   2),
      ('Nikhil',  'right_hand', 'right_arm_medium', 2),
      ('Manish',  'right_hand', 'right_arm_fast',   2),
      -- Phoenix Flames
      ('Aditya',  'right_hand', 'right_arm_fast',   1),
      ('Akhil',   'right_hand', 'right_arm_medium', 3),
      ('Tarun',   'left_hand',  'right_arm_fast',   2),
      ('Aakash',  'right_hand', 'right_arm_spin',   2),
      ('Varun',   'right_hand', 'right_arm_fast',   2),
      ('Sumit',   'right_hand', 'right_arm_medium', 2),
      ('Kunal',   'right_hand', 'right_arm_fast',   2),
      -- Silver Sharks
      ('Sanjay',  'right_hand', 'right_arm_fast',   1),
      ('Naveen',  'right_hand', 'right_arm_medium', 3),
      ('Harish',  'right_hand', 'right_arm_fast',   2),
      ('Ramesh',  'left_hand',  'right_arm_spin',   2),
      ('Suresh',  'right_hand', 'right_arm_fast',   2),
      ('Mahesh',  'right_hand', 'right_arm_medium', 2),
      ('Rakesh',  'right_hand', 'right_arm_fast',   2)
    RETURNING id, display_name
  ),
  mapping (team_name, player_name) AS (
    VALUES
      ('Royal Strikers',  'Arjun'),
      ('Royal Strikers',  'Vikram'),
      ('Royal Strikers',  'Rohit'),
      ('Royal Strikers',  'Surya'),
      ('Royal Strikers',  'Karan'),
      ('Royal Strikers',  'Pranav'),
      ('Royal Strikers',  'Ishan'),
      ('Storm Riders',    'Sachin'),
      ('Storm Riders',    'Rahul'),
      ('Storm Riders',    'Yash'),
      ('Storm Riders',    'Dev'),
      ('Storm Riders',    'Aman'),
      ('Storm Riders',    'Nikhil'),
      ('Storm Riders',    'Manish'),
      ('Phoenix Flames',  'Aditya'),
      ('Phoenix Flames',  'Akhil'),
      ('Phoenix Flames',  'Tarun'),
      ('Phoenix Flames',  'Aakash'),
      ('Phoenix Flames',  'Varun'),
      ('Phoenix Flames',  'Sumit'),
      ('Phoenix Flames',  'Kunal'),
      ('Silver Sharks',   'Sanjay'),
      ('Silver Sharks',   'Naveen'),
      ('Silver Sharks',   'Harish'),
      ('Silver Sharks',   'Ramesh'),
      ('Silver Sharks',   'Suresh'),
      ('Silver Sharks',   'Mahesh'),
      ('Silver Sharks',   'Rakesh')
  ),
  roster AS (
    INSERT INTO team_players (team_id, player_id, role)
    SELECT t.id, p.id, 'player'
    FROM mapping m
    JOIN new_teams   t ON t.name         = m.team_name
    JOIN new_players p ON p.display_name = m.player_name
    RETURNING 1
  ),

  -- 4 teams → C(4,2) = 6 round-robin matches, single round.
  -- Playoff matches (Q1 / Eliminator / Q2 / Final) get auto-scheduled
  -- by maybeAutoSchedulePlayoffs once these 6 go terminal.
  schedule (seq, team_a_name, team_b_name, scheduled_at) AS (
    VALUES
      (1, 'Royal Strikers', 'Storm Riders',   timestamptz '2026-05-18 09:00+05:30'),
      (2, 'Phoenix Flames', 'Silver Sharks',  timestamptz '2026-05-18 10:30+05:30'),
      (3, 'Royal Strikers', 'Phoenix Flames', timestamptz '2026-05-18 12:00+05:30'),
      (4, 'Storm Riders',   'Silver Sharks',  timestamptz '2026-05-18 13:30+05:30'),
      (5, 'Royal Strikers', 'Silver Sharks',  timestamptz '2026-05-18 15:00+05:30'),
      (6, 'Storm Riders',   'Phoenix Flames', timestamptz '2026-05-18 16:30+05:30')
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
  s.seq,
  'group',
  ta.id,
  tb.id,
  7,
  7,
  s.scheduled_at,
  'Bengaluru'
FROM schedule s
CROSS JOIN tournament t
JOIN new_teams ta ON ta.name = s.team_a_name
JOIN new_teams tb ON tb.name = s.team_b_name
ORDER BY s.seq;

COMMIT;
