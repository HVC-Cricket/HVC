-- =====================================================================
-- One-off seed: 7 teams + 49 players + roster entries for "Test 2"
-- ---------------------------------------------------------------------
-- Source: C:\Users\panee\Downloads\HVC.xlsx (column-per-team layout).
-- Run via Supabase Dashboard → SQL Editor, or:
--   pnpm exec supabase db query --linked --file scripts/seed-test-2-teams.sql
--
-- Defaults applied to every player:
--   batting_style = 'right_hand'
--   bowling_style = 'right_arm_fast'
--   category      = 2
--
-- NOT a migration — re-running creates duplicates (no unique constraint
-- on team name or player display_name). Intended as a one-shot import.
-- =====================================================================

BEGIN;

WITH
  -- 1. Resolve the tournament. Zero rows here → the whole import is a
  --    no-op, so a missing tournament won't half-populate anything.
  tournament AS (
    SELECT id FROM tournaments WHERE name = 'Test 2' LIMIT 1
  ),

  -- 2. Create the 7 teams under that tournament.
  new_teams AS (
    INSERT INTO teams (tournament_id, name, short_name)
    SELECT t.id, v.name, v.short_name
    FROM tournament t
    CROSS JOIN (VALUES
      ('Chalukya Chakravartis',    'CC'),
      ('Glorious Gangas',          'GG'),
      ('Wodeyars The Kings',       'WK'),
      ('Hoysala Hunters',          'HH'),
      ('Kadamba Warriors',         'KW'),
      ('Rashtrakuta Ranadheeras',  'RR'),
      ('Vijayanagara Royals',      'VR')
    ) v(name, short_name)
    RETURNING id, name
  ),

  -- 3. Create the 49 players with the requested defaults.
  new_players AS (
    INSERT INTO players (display_name, batting_style, bowling_style, category)
    VALUES
      ('Prasanna',              'right_hand', 'right_arm_fast', 2),
      ('Kantu',                 'right_hand', 'right_arm_fast', 2),
      ('Prasadu',               'right_hand', 'right_arm_fast', 2),
      ('Anirudha',              'right_hand', 'right_arm_fast', 2),
      ('Ranga Vittala',         'right_hand', 'right_arm_fast', 2),
      ('Yashu',                 'right_hand', 'right_arm_fast', 2),
      ('Prabhav',               'right_hand', 'right_arm_fast', 2),
      ('Praveena',              'right_hand', 'right_arm_fast', 2),
      ('Bharath',               'right_hand', 'right_arm_fast', 2),
      ('Srinidhi',              'right_hand', 'right_arm_fast', 2),
      ('Aprameya',              'right_hand', 'right_arm_fast', 2),
      ('Mahesh',                'right_hand', 'right_arm_fast', 2),
      ('Nandan',                'right_hand', 'right_arm_fast', 2),
      ('Satyadhyana',           'right_hand', 'right_arm_fast', 2),
      ('Guru Prasad',           'right_hand', 'right_arm_fast', 2),
      ('Teju',                  'right_hand', 'right_arm_fast', 2),
      ('Vadiraj',               'right_hand', 'right_arm_fast', 2),
      ('Akshay',                'right_hand', 'right_arm_fast', 2),
      ('Srisha',                'right_hand', 'right_arm_fast', 2),
      ('Anantha Hari',          'right_hand', 'right_arm_fast', 2),
      ('Pradhyumna',            'right_hand', 'right_arm_fast', 2),
      ('Pavan Kashyap',         'right_hand', 'right_arm_fast', 2),
      ('Ambareesha',            'right_hand', 'right_arm_fast', 2),
      ('Srivatsa Hatwar',       'right_hand', 'right_arm_fast', 2),
      ('Pavan Gautham',         'right_hand', 'right_arm_fast', 2),
      ('Balaji',                'right_hand', 'right_arm_fast', 2),
      ('Sudarshan',             'right_hand', 'right_arm_fast', 2),
      ('Sandeep',               'right_hand', 'right_arm_fast', 2),
      ('Madhu',                 'right_hand', 'right_arm_fast', 2),
      ('Ashrith',               'right_hand', 'right_arm_fast', 2),
      ('Badri',                 'right_hand', 'right_arm_fast', 2),
      ('Srinidhi Jr',           'right_hand', 'right_arm_fast', 2),
      ('Shyam',                 'right_hand', 'right_arm_fast', 2),
      ('Srikanth',              'right_hand', 'right_arm_fast', 2),
      ('Sudhanva',              'right_hand', 'right_arm_fast', 2),
      ('Srivatsa Bharadhwaj',   'right_hand', 'right_arm_fast', 2),
      ('Pranav',                'right_hand', 'right_arm_fast', 2),
      ('Sudhindra',             'right_hand', 'right_arm_fast', 2),
      ('Anatha Madhava',        'right_hand', 'right_arm_fast', 2),
      ('Ajith',                 'right_hand', 'right_arm_fast', 2),
      ('Amith',                 'right_hand', 'right_arm_fast', 2),
      ('Sri Krishna',           'right_hand', 'right_arm_fast', 2),
      ('Ravi',                  'right_hand', 'right_arm_fast', 2),
      ('Jeetu',                 'right_hand', 'right_arm_fast', 2),
      ('Sridhar Dixit',         'right_hand', 'right_arm_fast', 2),
      ('Paneendra',             'right_hand', 'right_arm_fast', 2),
      ('Aditya',                'right_hand', 'right_arm_fast', 2),
      ('Sridhar Smitha',        'right_hand', 'right_arm_fast', 2),
      ('Hrishikesha',           'right_hand', 'right_arm_fast', 2)
    RETURNING id, display_name
  ),

  -- 4. Roster mapping (team_name, player_name) used to join the team
  --    and player rows just inserted above.
  mapping (team_name, player_name) AS (
    VALUES
      ('Chalukya Chakravartis',   'Prasanna'),
      ('Chalukya Chakravartis',   'Kantu'),
      ('Chalukya Chakravartis',   'Prasadu'),
      ('Chalukya Chakravartis',   'Anirudha'),
      ('Chalukya Chakravartis',   'Ranga Vittala'),
      ('Chalukya Chakravartis',   'Yashu'),
      ('Chalukya Chakravartis',   'Prabhav'),
      ('Glorious Gangas',         'Praveena'),
      ('Glorious Gangas',         'Bharath'),
      ('Glorious Gangas',         'Srinidhi'),
      ('Glorious Gangas',         'Aprameya'),
      ('Glorious Gangas',         'Mahesh'),
      ('Glorious Gangas',         'Nandan'),
      ('Glorious Gangas',         'Satyadhyana'),
      ('Wodeyars The Kings',      'Guru Prasad'),
      ('Wodeyars The Kings',      'Teju'),
      ('Wodeyars The Kings',      'Vadiraj'),
      ('Wodeyars The Kings',      'Akshay'),
      ('Wodeyars The Kings',      'Srisha'),
      ('Wodeyars The Kings',      'Anantha Hari'),
      ('Wodeyars The Kings',      'Pradhyumna'),
      ('Hoysala Hunters',         'Pavan Kashyap'),
      ('Hoysala Hunters',         'Ambareesha'),
      ('Hoysala Hunters',         'Srivatsa Hatwar'),
      ('Hoysala Hunters',         'Pavan Gautham'),
      ('Hoysala Hunters',         'Balaji'),
      ('Hoysala Hunters',         'Sudarshan'),
      ('Hoysala Hunters',         'Sandeep'),
      ('Kadamba Warriors',        'Madhu'),
      ('Kadamba Warriors',        'Ashrith'),
      ('Kadamba Warriors',        'Badri'),
      ('Kadamba Warriors',        'Srinidhi Jr'),
      ('Kadamba Warriors',        'Shyam'),
      ('Kadamba Warriors',        'Srikanth'),
      ('Kadamba Warriors',        'Sudhanva'),
      ('Rashtrakuta Ranadheeras', 'Srivatsa Bharadhwaj'),
      ('Rashtrakuta Ranadheeras', 'Pranav'),
      ('Rashtrakuta Ranadheeras', 'Sudhindra'),
      ('Rashtrakuta Ranadheeras', 'Anatha Madhava'),
      ('Rashtrakuta Ranadheeras', 'Ajith'),
      ('Rashtrakuta Ranadheeras', 'Amith'),
      ('Rashtrakuta Ranadheeras', 'Sri Krishna'),
      ('Vijayanagara Royals',     'Ravi'),
      ('Vijayanagara Royals',     'Jeetu'),
      ('Vijayanagara Royals',     'Sridhar Dixit'),
      ('Vijayanagara Royals',     'Paneendra'),
      ('Vijayanagara Royals',     'Aditya'),
      ('Vijayanagara Royals',     'Sridhar Smitha'),
      ('Vijayanagara Royals',     'Hrishikesha')
  )

-- 5. Wire each player onto their team's roster.
INSERT INTO team_players (team_id, player_id, role)
SELECT t.id, p.id, 'player'
FROM mapping m
JOIN new_teams   t ON t.name         = m.team_name
JOIN new_players p ON p.display_name = m.player_name;

COMMIT;
