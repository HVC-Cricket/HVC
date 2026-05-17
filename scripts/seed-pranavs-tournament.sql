-- =====================================================================
-- Seed: Pranav's tournament — 6 teams + 42 players + 15 round-robin matches
-- Format = round_robin_playoff_final (IPL-style). Single round-robin
-- (C(6,2) = 15 matches); once every group match goes terminal, the
-- playoff chain auto-schedules via maybeAutoSchedulePlayoffs in
-- finalizeMatch:
--   - Qualifier 1 (top 2 on points table)        — created on last group finalize
--   - Eliminator  (#3 vs #4)                     — created on Q1 finalize
--   - Qualifier 2 (Q1 loser vs Eliminator winner) — on Eliminator finalize
--   - Final       (Q1 winner vs Q2 winner)        — on Q2 finalize
--
-- 1 Cat 1 + 1 Cat 3 + 5 Cat 2 per team, so the special-over rules can be
-- exercised. Targets dev project (clqdimzthzcpurtwhtej).
--
--   pnpm exec supabase db query --linked --file scripts/seed-pranavs-tournament.sql
--
-- Creates the tournament row too (status = 'draft' so the tester can
-- promote it themselves). One-shot only — re-running will fail on the
-- unique slug constraint.
-- =====================================================================

BEGIN;

WITH
  new_tournament AS (
    INSERT INTO tournaments (
      slug, name, description, format,
      default_overs_per_innings, default_players_per_side,
      start_date, end_date, venue, status
    )
    VALUES (
      'pranavs-tournament',
      'Pranav''s Tournament',
      '6-team round-robin then IPL-style playoffs (Qualifier 1, Eliminator, Qualifier 2, Final) — for testing the auto-scheduled bracket.',
      'round_robin_playoff_final',
      7, 7,
      date '2026-05-20',
      date '2026-05-22',
      'Bengaluru',
      'draft'
    )
    RETURNING id
  ),
  new_teams AS (
    INSERT INTO teams (tournament_id, name, short_name)
    SELECT t.id, v.name, v.short_name
    FROM new_tournament t
    CROSS JOIN (VALUES
      ('Thunder Wolves',     'TW'),
      ('Mystic Mavericks',   'MM'),
      ('Crimson Crusaders',  'CC'),
      ('Emerald Eagles',     'EE'),
      ('Cobalt Sharks',      'CS'),
      ('Golden Gladiators',  'GG')
    ) v(name, short_name)
    RETURNING id, name
  ),
  -- 1 Cat 1 (first per team) + 1 Cat 3 (second per team) + 5 Cat 2.
  new_players AS (
    INSERT INTO players (display_name, batting_style, bowling_style, category)
    VALUES
      -- Thunder Wolves
      ('Rohan',     'right_hand', 'right_arm_fast',   1),
      ('Karthik',   'right_hand', 'right_arm_medium', 3),
      ('Vivek',     'right_hand', 'right_arm_fast',   2),
      ('Suhas',     'left_hand',  'right_arm_spin',   2),
      ('Anand',     'right_hand', 'right_arm_fast',   2),
      ('Jay',       'right_hand', 'right_arm_medium', 2),
      ('Manoj',     'right_hand', 'right_arm_fast',   2),
      -- Mystic Mavericks
      ('Vinay',     'right_hand', 'right_arm_fast',   1),
      ('Deepak',    'right_hand', 'right_arm_medium', 3),
      ('Ravi K',    'right_hand', 'right_arm_fast',   2),
      ('Praveen',   'left_hand',  'right_arm_spin',   2),
      ('Naren',     'right_hand', 'right_arm_fast',   2),
      ('Vimal',     'right_hand', 'right_arm_medium', 2),
      ('Tanmay',    'right_hand', 'right_arm_fast',   2),
      -- Crimson Crusaders
      ('Sandesh',   'right_hand', 'right_arm_fast',   1),
      ('Pavan K',   'right_hand', 'right_arm_medium', 3),
      ('Rajesh',    'right_hand', 'right_arm_fast',   2),
      ('Murali',    'left_hand',  'right_arm_spin',   2),
      ('Kiran',     'right_hand', 'right_arm_fast',   2),
      ('Gokul',     'right_hand', 'right_arm_medium', 2),
      ('Yogesh',    'right_hand', 'right_arm_fast',   2),
      -- Emerald Eagles
      ('Bhavesh',   'right_hand', 'right_arm_fast',   1),
      ('Anil',      'right_hand', 'right_arm_medium', 3),
      ('Rishi',     'right_hand', 'right_arm_fast',   2),
      ('Hemanth',   'left_hand',  'right_arm_spin',   2),
      ('Bharat',    'right_hand', 'right_arm_fast',   2),
      ('Lokesh',    'right_hand', 'right_arm_medium', 2),
      ('Sunil',     'right_hand', 'right_arm_fast',   2),
      -- Cobalt Sharks
      ('Vishal',    'right_hand', 'right_arm_fast',   1),
      ('Raghav',    'right_hand', 'right_arm_medium', 3),
      ('Mohan',     'right_hand', 'right_arm_fast',   2),
      ('Chetan',    'left_hand',  'right_arm_spin',   2),
      ('Abhishek',  'right_hand', 'right_arm_fast',   2),
      ('Sumanth',   'right_hand', 'right_arm_medium', 2),
      ('Krish',     'right_hand', 'right_arm_fast',   2),
      -- Golden Gladiators
      ('Nitin',     'right_hand', 'right_arm_fast',   1),
      ('Shantanu',  'right_hand', 'right_arm_medium', 3),
      ('Vasu',      'right_hand', 'right_arm_fast',   2),
      ('Vinod',     'left_hand',  'right_arm_spin',   2),
      ('Arun',      'right_hand', 'right_arm_fast',   2),
      ('Aryan',     'right_hand', 'right_arm_medium', 2),
      ('Veer',      'right_hand', 'right_arm_fast',   2)
    RETURNING id, display_name
  ),
  mapping (team_name, player_name) AS (
    VALUES
      ('Thunder Wolves',     'Rohan'),
      ('Thunder Wolves',     'Karthik'),
      ('Thunder Wolves',     'Vivek'),
      ('Thunder Wolves',     'Suhas'),
      ('Thunder Wolves',     'Anand'),
      ('Thunder Wolves',     'Jay'),
      ('Thunder Wolves',     'Manoj'),
      ('Mystic Mavericks',   'Vinay'),
      ('Mystic Mavericks',   'Deepak'),
      ('Mystic Mavericks',   'Ravi K'),
      ('Mystic Mavericks',   'Praveen'),
      ('Mystic Mavericks',   'Naren'),
      ('Mystic Mavericks',   'Vimal'),
      ('Mystic Mavericks',   'Tanmay'),
      ('Crimson Crusaders',  'Sandesh'),
      ('Crimson Crusaders',  'Pavan K'),
      ('Crimson Crusaders',  'Rajesh'),
      ('Crimson Crusaders',  'Murali'),
      ('Crimson Crusaders',  'Kiran'),
      ('Crimson Crusaders',  'Gokul'),
      ('Crimson Crusaders',  'Yogesh'),
      ('Emerald Eagles',     'Bhavesh'),
      ('Emerald Eagles',     'Anil'),
      ('Emerald Eagles',     'Rishi'),
      ('Emerald Eagles',     'Hemanth'),
      ('Emerald Eagles',     'Bharat'),
      ('Emerald Eagles',     'Lokesh'),
      ('Emerald Eagles',     'Sunil'),
      ('Cobalt Sharks',      'Vishal'),
      ('Cobalt Sharks',      'Raghav'),
      ('Cobalt Sharks',      'Mohan'),
      ('Cobalt Sharks',      'Chetan'),
      ('Cobalt Sharks',      'Abhishek'),
      ('Cobalt Sharks',      'Sumanth'),
      ('Cobalt Sharks',      'Krish'),
      ('Golden Gladiators',  'Nitin'),
      ('Golden Gladiators',  'Shantanu'),
      ('Golden Gladiators',  'Vasu'),
      ('Golden Gladiators',  'Vinod'),
      ('Golden Gladiators',  'Arun'),
      ('Golden Gladiators',  'Aryan'),
      ('Golden Gladiators',  'Veer')
  ),
  roster AS (
    INSERT INTO team_players (team_id, player_id, role)
    SELECT t.id, p.id, 'player'
    FROM mapping m
    JOIN new_teams   t ON t.name         = m.team_name
    JOIN new_players p ON p.display_name = m.player_name
    RETURNING 1
  ),

  -- 6 teams → C(6,2) = 15 single round-robin matches across two days.
  -- Pairs are interleaved so no team plays back-to-back where possible.
  schedule (seq, team_a_name, team_b_name, scheduled_at) AS (
    VALUES
      ( 1, 'Thunder Wolves',     'Mystic Mavericks',   timestamptz '2026-05-20 09:00+05:30'),
      ( 2, 'Crimson Crusaders',  'Emerald Eagles',     timestamptz '2026-05-20 10:00+05:30'),
      ( 3, 'Cobalt Sharks',      'Golden Gladiators',  timestamptz '2026-05-20 11:00+05:30'),
      ( 4, 'Thunder Wolves',     'Crimson Crusaders',  timestamptz '2026-05-20 12:00+05:30'),
      ( 5, 'Mystic Mavericks',   'Cobalt Sharks',      timestamptz '2026-05-20 13:00+05:30'),
      ( 6, 'Emerald Eagles',     'Golden Gladiators',  timestamptz '2026-05-20 14:00+05:30'),
      ( 7, 'Thunder Wolves',     'Emerald Eagles',     timestamptz '2026-05-20 15:00+05:30'),
      ( 8, 'Mystic Mavericks',   'Golden Gladiators',  timestamptz '2026-05-20 16:00+05:30'),
      ( 9, 'Crimson Crusaders',  'Cobalt Sharks',      timestamptz '2026-05-20 17:00+05:30'),
      (10, 'Thunder Wolves',     'Cobalt Sharks',      timestamptz '2026-05-21 09:00+05:30'),
      (11, 'Mystic Mavericks',   'Emerald Eagles',     timestamptz '2026-05-21 10:00+05:30'),
      (12, 'Crimson Crusaders',  'Golden Gladiators',  timestamptz '2026-05-21 11:00+05:30'),
      (13, 'Thunder Wolves',     'Golden Gladiators',  timestamptz '2026-05-21 12:00+05:30'),
      (14, 'Mystic Mavericks',   'Crimson Crusaders',  timestamptz '2026-05-21 13:00+05:30'),
      (15, 'Emerald Eagles',     'Cobalt Sharks',      timestamptz '2026-05-21 14:00+05:30')
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
CROSS JOIN new_tournament t
JOIN new_teams ta ON ta.name = s.team_a_name
JOIN new_teams tb ON tb.name = s.team_b_name
ORDER BY s.seq;

COMMIT;
