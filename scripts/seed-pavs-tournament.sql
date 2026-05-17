-- =====================================================================
-- Seed: 7 teams + 49 players + 21 round-robin matches for "Pav's tournament"
-- Adapted from seed-test-2-{teams,matches}.sql; targets dev project.
--   pnpm exec supabase db query --linked --file scripts/seed-pavs-tournament.sql
-- One-shot only — re-running will duplicate.
-- =====================================================================

BEGIN;

WITH
  tournament AS (
    SELECT id FROM tournaments WHERE slug = 'pavs-tournament' LIMIT 1
  ),
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
  ),
  roster AS (
    INSERT INTO team_players (team_id, player_id, role)
    SELECT t.id, p.id, 'player'
    FROM mapping m
    JOIN new_teams   t ON t.name         = m.team_name
    JOIN new_players p ON p.display_name = m.player_name
    RETURNING 1
  ),

  schedule (seq, team_a_name, team_b_name, scheduled_at) AS (
    VALUES
      ( 1, 'Hoysala Hunters',        'Glorious Gangas',         timestamptz '2026-05-16 09:00+05:30'),
      ( 2, 'Chalukya Chakravartis',  'Vijayanagara Royals',     timestamptz '2026-05-16 10:00+05:30'),
      ( 3, 'Rashtrakuta Ranadheeras','Glorious Gangas',         timestamptz '2026-05-16 11:00+05:30'),
      ( 4, 'Chalukya Chakravartis',  'Kadamba Warriors',        timestamptz '2026-05-16 12:00+05:30'),
      ( 5, 'Hoysala Hunters',        'Vijayanagara Royals',     timestamptz '2026-05-16 13:00+05:30'),
      ( 6, 'Wodeyars The Kings',     'Glorious Gangas',         timestamptz '2026-05-16 14:00+05:30'),
      ( 7, 'Rashtrakuta Ranadheeras','Kadamba Warriors',        timestamptz '2026-05-16 15:00+05:30'),
      ( 8, 'Chalukya Chakravartis',  'Wodeyars The Kings',      timestamptz '2026-05-16 16:00+05:30'),
      ( 9, 'Hoysala Hunters',        'Rashtrakuta Ranadheeras', timestamptz '2026-05-16 17:00+05:30'),
      (10, 'Vijayanagara Royals',    'Kadamba Warriors',        timestamptz '2026-05-16 18:00+05:30'),
      (11, 'Rashtrakuta Ranadheeras','Chalukya Chakravartis',   timestamptz '2026-05-16 19:00+05:30'),
      (12, 'Wodeyars The Kings',     'Vijayanagara Royals',     timestamptz '2026-05-17 09:00+05:30'),
      (13, 'Glorious Gangas',        'Kadamba Warriors',        timestamptz '2026-05-17 10:00+05:30'),
      (14, 'Rashtrakuta Ranadheeras','Wodeyars The Kings',      timestamptz '2026-05-17 11:00+05:30'),
      (15, 'Chalukya Chakravartis',  'Glorious Gangas',         timestamptz '2026-05-17 12:00+05:30'),
      (16, 'Hoysala Hunters',        'Kadamba Warriors',        timestamptz '2026-05-17 13:00+05:30'),
      (17, 'Vijayanagara Royals',    'Glorious Gangas',         timestamptz '2026-05-17 14:00+05:30'),
      (18, 'Hoysala Hunters',        'Wodeyars The Kings',      timestamptz '2026-05-17 15:00+05:30'),
      (19, 'Rashtrakuta Ranadheeras','Vijayanagara Royals',     timestamptz '2026-05-17 16:00+05:30'),
      (20, 'Chalukya Chakravartis',  'Hoysala Hunters',         timestamptz '2026-05-17 17:00+05:30'),
      (21, 'Wodeyars The Kings',     'Kadamba Warriors',        timestamptz '2026-05-17 18:00+05:30')
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
