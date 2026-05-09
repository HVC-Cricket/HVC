-- =====================================================================
-- HVC Scoring - Database schema for Supabase
-- Box cricket tournament scoring + spectator app
--
-- HOW TO RUN:
--   1. Open your Supabase project -> SQL Editor -> New query
--   2. Paste this entire file and Run
--   3. After your first user signs up, promote them to super admin:
--        update profiles set is_super_admin = true where id = '<that-user-uuid>';
--   4. (Optional) Create storage buckets for logos / photos in the dashboard
--      (or with the storage.buckets inserts at the bottom of this file).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive text (slugs, emails)


-- ---------------------------------------------------------------------
-- 1. Profiles  (extends Supabase auth.users)
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null,
  avatar_url      text,
  phone           text,
  is_super_admin  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ---------------------------------------------------------------------
-- 2. Tournaments
-- ---------------------------------------------------------------------
create table if not exists tournaments (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  slug                        citext not null unique,
  description                 text,
  format                      text not null check (format in ('league','knockout','group_then_knockout')),
  default_overs_per_innings   int  not null default 6,
  default_players_per_side    int  not null default 6,
  start_date                  date,
  end_date                    date,
  venue                       text,
  rules                       jsonb not null default '{}'::jsonb,
  logo_url                    text,
  banner_url                  text,
  status                      text not null default 'draft'
                                check (status in ('draft','active','completed','archived')),
  created_by                  uuid references profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. Tournament admins  (per-tournament permissions)
-- ---------------------------------------------------------------------
create table if not exists tournament_admins (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references tournaments(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  role            text not null check (role in ('organizer','scorer')),
  added_by        uuid references profiles(id),
  created_at      timestamptz not null default now(),
  unique (tournament_id, user_id)
);


-- ---------------------------------------------------------------------
-- 4. Teams  (scoped to a tournament)
-- ---------------------------------------------------------------------
create table if not exists teams (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references tournaments(id) on delete cascade,
  name            text not null,
  short_name      text not null,
  logo_url        text,
  created_at      timestamptz not null default now(),
  unique (tournament_id, name),
  unique (tournament_id, short_name)
);


-- ---------------------------------------------------------------------
-- 5. Players  (global registry - same person across tournaments)
-- ---------------------------------------------------------------------
create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  display_name    text not null,
  phone           text,
  photo_url       text,
  batting_style   text,                              -- e.g. 'right_hand', 'left_hand'
  bowling_style   text,                              -- e.g. 'right_arm_medium'
  -- HVC player category: 1, 2, or 3. Drives bowling-order rules and special
  -- batting rules (Cat 1 = over 1 specialist, Cat 3 = over 2 specialist).
  -- Nullable so non-HVC tournaments don't have to set it.
  category        smallint check (category in (1, 2, 3)),
  linked_user_id  uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 6. Team players  (roster per team)
-- ---------------------------------------------------------------------
create table if not exists team_players (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete cascade,
  player_id       uuid not null references players(id) on delete restrict,
  role            text not null default 'player'
                    check (role in ('captain','vice_captain','wicket_keeper','player')),
  created_at      timestamptz not null default now(),
  unique (team_id, player_id)
);


-- ---------------------------------------------------------------------
-- 7. Matches
-- ---------------------------------------------------------------------
create table if not exists matches (
  id                    uuid primary key default gen_random_uuid(),
  tournament_id         uuid not null references tournaments(id) on delete cascade,
  match_number          int  not null,
  stage                 text not null default 'group'
                          check (stage in ('group','qualifier','quarter','semi','final','exhibition')),
  team_a_id             uuid not null references teams(id),
  team_b_id             uuid not null references teams(id),
  scheduled_at          timestamptz,
  started_at            timestamptz,
  ended_at              timestamptz,
  venue                 text,
  overs_per_innings     int  not null,
  players_per_side      int  not null,
  format_overrides      jsonb,
  toss_winner_id        uuid references teams(id),
  toss_decision         text check (toss_decision in ('bat','bowl')),
  status                text not null default 'scheduled'
                          check (status in ('scheduled','live','innings_break','completed','abandoned')),
  result_type           text check (result_type in ('normal','tie','super_over','no_result','abandoned')),
  winner_id             uuid references teams(id),
  win_margin            text,
  player_of_match_id    uuid references players(id),
  current_innings_id    uuid,                     -- FK added after innings table exists
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (team_a_id <> team_b_id),
  unique (tournament_id, match_number)
);


-- ---------------------------------------------------------------------
-- 8. Match players  (playing XI per team per match)
-- ---------------------------------------------------------------------
create table if not exists match_players (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id) on delete cascade,
  team_id         uuid not null references teams(id),
  player_id       uuid not null references players(id),
  batting_order   int,
  is_keeper       boolean not null default false,
  is_captain      boolean not null default false,
  is_substitute   boolean not null default false,
  unique (match_id, player_id)
);


-- ---------------------------------------------------------------------
-- 9. Innings
-- ---------------------------------------------------------------------
create table if not exists innings (
  id                  uuid primary key default gen_random_uuid(),
  match_id            uuid not null references matches(id) on delete cascade,
  innings_number      int  not null check (innings_number between 1 and 4),
  batting_team_id     uuid not null references teams(id),
  bowling_team_id     uuid not null references teams(id),
  total_runs          int  not null default 0,
  total_wickets       int  not null default 0,
  total_legal_balls   int  not null default 0,
  extras_wides        int  not null default 0,
  extras_no_balls     int  not null default 0,
  extras_byes         int  not null default 0,
  extras_leg_byes     int  not null default 0,
  extras_penalty      int  not null default 0,
  target              int,
  declared            boolean not null default false,
  is_complete         boolean not null default false,
  started_at          timestamptz,
  ended_at            timestamptz,
  unique (match_id, innings_number)
);

-- back-fill the FK from matches.current_innings_id -> innings.id
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'matches_current_innings_fk'
  ) then
    alter table matches
      add constraint matches_current_innings_fk
      foreign key (current_innings_id) references innings(id) on delete set null;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 10. Balls   (the heart of the scoring system)
-- ---------------------------------------------------------------------
create table if not exists balls (
  id                uuid primary key default gen_random_uuid(),
  innings_id        uuid not null references innings(id) on delete cascade,
  over_number       int  not null,
  ball_in_over      int  not null,
  legal_ball_seq    int,                             -- null for wides/no-balls
  batter_id         uuid not null references players(id),
  non_striker_id    uuid not null references players(id),
  bowler_id         uuid not null references players(id),
  runs_off_bat      int  not null default 0,
  extras            int  not null default 0,
  extra_type        text check (extra_type in ('wide','no_ball','bye','leg_bye','penalty')),
  is_wicket         boolean not null default false,
  wicket_type       text,                            -- bowled / caught / lbw / run_out / stumped / hit_wicket / retired / timed_out / obstructing / net_out / etc.
  player_out_id     uuid references players(id),
  fielder_id        uuid references players(id),
  is_free_hit       boolean not null default false,
  is_powerplay      boolean not null default false,
  shot_type         text,
  shot_zone         text,
  pitch_x           numeric,
  pitch_y           numeric,
  wagon_x           numeric,
  wagon_y           numeric,
  commentary        text,
  custom_data       jsonb,                           -- box-cricket specifics (net hit type, zone, etc.)
  is_voided         boolean not null default false,  -- "undo" - never delete, just mark voided
  voided_by         uuid references profiles(id),
  voided_at         timestamptz,
  scored_by         uuid not null references profiles(id),
  scored_at         timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 11. Audit log
-- ---------------------------------------------------------------------
create table if not exists audit_log (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid references tournaments(id) on delete set null,
  match_id        uuid references matches(id) on delete set null,
  actor_id        uuid references profiles(id),
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);


-- =====================================================================
-- INDEXES
-- =====================================================================
create index if not exists idx_balls_innings           on balls (innings_id, over_number, ball_in_over) where is_voided = false;
create index if not exists idx_balls_batter            on balls (batter_id) where is_voided = false;
create index if not exists idx_balls_bowler            on balls (bowler_id) where is_voided = false;
create index if not exists idx_innings_match           on innings (match_id, innings_number);
create index if not exists idx_matches_tournament      on matches (tournament_id, status);
create index if not exists idx_matches_live            on matches (status) where status = 'live';
create index if not exists idx_team_players_team       on team_players (team_id);
create index if not exists idx_match_players_match     on match_players (match_id, team_id);
create index if not exists idx_audit_match             on audit_log (match_id, created_at desc);
create index if not exists idx_audit_tournament        on audit_log (tournament_id, created_at desc);
create index if not exists idx_tournament_admins_user  on tournament_admins (user_id);
create index if not exists idx_teams_tournament        on teams (tournament_id);
-- One auth user maps to at most one player record (linked_user_id is nullable;
-- multiple unlinked players are fine).
create unique index if not exists ux_players_linked_user_id
  on players (linked_user_id)
  where linked_user_id is not null;


-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- ---- updated_at maintenance ----
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists trg_tournaments_updated_at on tournaments;
create trigger trg_tournaments_updated_at
  before update on tournaments
  for each row execute function set_updated_at();

drop trigger if exists trg_matches_updated_at on matches;
create trigger trg_matches_updated_at
  before update on matches
  for each row execute function set_updated_at();


-- ---- Prevent self-promotion to super admin ----
-- Note: this trigger ignores callers with null auth.uid() — i.e. direct DB
-- access via the Management API, dashboard SQL editor, or the service_role
-- key. Those callers are already trusted (they bypass RLS entirely), and
-- without this carve-out the very first super admin is un-creatable.
create or replace function prevent_self_promote()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_caller_is_super boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.is_super_admin is distinct from old.is_super_admin then
    v_caller_is_super := coalesce(
      (select is_super_admin from profiles where id = auth.uid()), false
    );
    if not v_caller_is_super then
      raise exception 'Only super admins can change is_super_admin';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_prevent_self_promote on profiles;
create trigger trg_profiles_prevent_self_promote
  before update on profiles
  for each row execute function prevent_self_promote();


-- ---- Recompute innings aggregates from balls ----
-- Cricket innings rarely exceed ~600 balls; full recompute is cheap and safe.
create or replace function recompute_innings(p_innings_id uuid)
returns void language plpgsql as $$
begin
  update innings i set
    total_runs = coalesce((
      select sum(runs_off_bat + extras) from balls
      where innings_id = p_innings_id and is_voided = false
    ), 0),
    total_wickets = coalesce((
      select count(*) from balls
      where innings_id = p_innings_id and is_voided = false and is_wicket = true
    ), 0),
    total_legal_balls = coalesce((
      select count(*) from balls
      where innings_id = p_innings_id and is_voided = false
        and (extra_type is null or extra_type in ('bye','leg_bye'))
    ), 0),
    extras_wides = coalesce((
      select sum(extras) from balls
      where innings_id = p_innings_id and is_voided = false and extra_type = 'wide'
    ), 0),
    extras_no_balls = coalesce((
      select sum(extras) from balls
      where innings_id = p_innings_id and is_voided = false and extra_type = 'no_ball'
    ), 0),
    extras_byes = coalesce((
      select sum(extras) from balls
      where innings_id = p_innings_id and is_voided = false and extra_type = 'bye'
    ), 0),
    extras_leg_byes = coalesce((
      select sum(extras) from balls
      where innings_id = p_innings_id and is_voided = false and extra_type = 'leg_bye'
    ), 0),
    extras_penalty = coalesce((
      select sum(extras) from balls
      where innings_id = p_innings_id and is_voided = false and extra_type = 'penalty'
    ), 0)
  where i.id = p_innings_id;
end $$;

create or replace function trg_balls_recompute_innings()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    perform recompute_innings(old.innings_id);
    return old;
  else
    perform recompute_innings(new.innings_id);
    return new;
  end if;
end $$;

drop trigger if exists balls_recompute_innings on balls;
create trigger balls_recompute_innings
  after insert or update or delete on balls
  for each row execute function trg_balls_recompute_innings();


-- =====================================================================
-- VIEWS  (derived stats so we don't store redundant data)
-- =====================================================================

create or replace view v_innings_batting as
select
  b.innings_id,
  b.batter_id                                                       as player_id,
  sum(b.runs_off_bat)                                               as runs,
  count(*) filter (where coalesce(b.extra_type,'') <> 'wide')       as balls_faced,
  count(*) filter (where b.runs_off_bat = 4)                        as fours,
  count(*) filter (where b.runs_off_bat = 6)                        as sixes
from balls b
where b.is_voided = false
group by b.innings_id, b.batter_id;


create or replace view v_innings_bowling as
select
  b.innings_id,
  b.bowler_id                                                       as player_id,
  count(*) filter (where coalesce(b.extra_type,'') not in ('wide','no_ball')) as legal_balls,
  sum(b.runs_off_bat)
    + coalesce(sum(b.extras) filter (where b.extra_type in ('wide','no_ball','penalty')), 0) as runs_conceded,
  count(*) filter (
    where b.is_wicket = true
      and b.wicket_type in ('bowled','caught','lbw','stumped','hit_wicket','caught_and_bowled')
  )                                                                 as wickets,
  count(*) filter (where b.extra_type = 'wide')                     as wides,
  count(*) filter (where b.extra_type = 'no_ball')                  as no_balls
from balls b
where b.is_voided = false
group by b.innings_id, b.bowler_id;


create or replace view v_fall_of_wickets as
select
  b.innings_id,
  b.player_out_id                                                   as player_id,
  b.over_number,
  b.ball_in_over,
  b.wicket_type,
  i.total_runs                                                      as score_at_fall,
  row_number() over (partition by b.innings_id order by b.scored_at) as wicket_number
from balls b
join innings i on i.id = b.innings_id
where b.is_voided = false and b.is_wicket = true;


create or replace view v_match_summary as
select
  m.id                                                              as match_id,
  m.tournament_id,
  m.match_number,
  m.stage,
  m.status,
  m.team_a_id, ta.name as team_a_name, ta.short_name as team_a_short,
  m.team_b_id, tb.name as team_b_name, tb.short_name as team_b_short,
  i1.total_runs                                                     as innings_1_runs,
  i1.total_wickets                                                  as innings_1_wickets,
  i1.total_legal_balls                                              as innings_1_legal_balls,
  i2.total_runs                                                     as innings_2_runs,
  i2.total_wickets                                                  as innings_2_wickets,
  i2.total_legal_balls                                              as innings_2_legal_balls,
  m.winner_id,
  m.win_margin,
  m.result_type,
  m.scheduled_at, m.started_at, m.ended_at
from matches m
join teams ta on ta.id = m.team_a_id
join teams tb on tb.id = m.team_b_id
left join innings i1 on i1.match_id = m.id and i1.innings_number = 1
left join innings i2 on i2.match_id = m.id and i2.innings_number = 2;


create or replace view v_points_table as
with results as (
  select m.tournament_id, m.team_a_id as team_id,
    case
      when m.winner_id = m.team_a_id then 'W'
      when m.winner_id = m.team_b_id then 'L'
      when m.result_type = 'tie' then 'T'
      when m.result_type in ('no_result','abandoned') then 'NR'
    end as result
  from matches m where m.status = 'completed'
  union all
  select m.tournament_id, m.team_b_id as team_id,
    case
      when m.winner_id = m.team_b_id then 'W'
      when m.winner_id = m.team_a_id then 'L'
      when m.result_type = 'tie' then 'T'
      when m.result_type in ('no_result','abandoned') then 'NR'
    end as result
  from matches m where m.status = 'completed'
)
select
  tournament_id,
  team_id,
  count(*)                                  as played,
  count(*) filter (where result = 'W')      as won,
  count(*) filter (where result = 'L')      as lost,
  count(*) filter (where result = 'T')      as tied,
  count(*) filter (where result = 'NR')     as no_results,
  count(*) filter (where result = 'W') * 2
    + count(*) filter (where result in ('T','NR')) as points
from results
group by tournament_id, team_id;


create or replace view v_player_tournament_stats as
select
  t.id                                                              as tournament_id,
  p.id                                                              as player_id,
  p.display_name,
  coalesce(sum(vb.runs), 0)                                         as runs,
  coalesce(sum(vb.balls_faced), 0)                                  as balls_faced,
  coalesce(sum(vb.fours), 0)                                        as fours,
  coalesce(sum(vb.sixes), 0)                                        as sixes,
  coalesce(sum(vbo.wickets), 0)                                     as wickets,
  coalesce(sum(vbo.runs_conceded), 0)                               as runs_conceded,
  coalesce(sum(vbo.legal_balls), 0)                                 as legal_balls_bowled
from tournaments t
cross join players p
left join innings i  on i.match_id in (select id from matches where tournament_id = t.id)
left join v_innings_batting vb  on vb.innings_id = i.id and vb.player_id = p.id
left join v_innings_bowling vbo on vbo.innings_id = i.id and vbo.player_id = p.id
group by t.id, p.id, p.display_name;


-- =====================================================================
-- RLS HELPERS  (SECURITY DEFINER avoids RLS recursion in policies)
-- =====================================================================

create or replace function is_super_admin(p_user_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select is_super_admin from profiles where id = p_user_id), false);
$$;

create or replace function is_tournament_admin(p_tournament_id uuid, p_user_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select
    is_super_admin(p_user_id)
    or exists (
      select 1 from tournament_admins
      where tournament_id = p_tournament_id and user_id = p_user_id
    );
$$;

create or replace function is_tournament_organizer(p_tournament_id uuid, p_user_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select
    is_super_admin(p_user_id)
    or exists (
      select 1 from tournament_admins
      where tournament_id = p_tournament_id and user_id = p_user_id and role = 'organizer'
    );
$$;

-- Helper: tournament_id of a match
create or replace function tournament_id_for_match(p_match_id uuid)
returns uuid language sql security definer set search_path = public stable as $$
  select tournament_id from matches where id = p_match_id;
$$;

-- Helper: tournament_id of an innings
create or replace function tournament_id_for_innings(p_innings_id uuid)
returns uuid language sql security definer set search_path = public stable as $$
  select m.tournament_id
  from innings i join matches m on m.id = i.match_id
  where i.id = p_innings_id;
$$;

-- Helper: resolve email to user_id from auth.users.
-- SECURITY DEFINER so RLS-capped callers (organizers adding scorers, etc.)
-- can resolve users without needing service-role access. Authenticated only.
create or replace function lookup_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
stable
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function lookup_user_id_by_email(text) from public;
grant execute on function lookup_user_id_by_email(text) to authenticated;

-- Inverse lookup: resolve user_id back to email. Used to prefill the
-- "linked email" field on the player edit form so an organizer can see who
-- the record is linked to today. Authenticated only — same exposure shape
-- as the by-email helper above.
create or replace function lookup_email_by_user_id(p_user_id uuid)
returns text
language sql
security definer
set search_path = public, auth
stable
as $$
  select email from auth.users where id = p_user_id;
$$;
revoke all on function lookup_email_by_user_id(uuid) from public;
grant execute on function lookup_email_by_user_id(uuid) to authenticated;


-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

alter table profiles            enable row level security;
alter table tournaments         enable row level security;
alter table tournament_admins   enable row level security;
alter table teams               enable row level security;
alter table players             enable row level security;
alter table team_players        enable row level security;
alter table matches             enable row level security;
alter table match_players       enable row level security;
alter table innings             enable row level security;
alter table balls               enable row level security;
alter table audit_log           enable row level security;


-- ---- profiles ----
drop policy if exists "profiles_read_all"    on profiles;
drop policy if exists "profiles_update_own"  on profiles;
create policy "profiles_read_all"   on profiles for select using (true);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);


-- ---- tournaments ----  (public read, organizer/super-admin write)
drop policy if exists "tournaments_read_all"   on tournaments;
drop policy if exists "tournaments_insert"     on tournaments;
drop policy if exists "tournaments_update"     on tournaments;
drop policy if exists "tournaments_delete"     on tournaments;
create policy "tournaments_read_all" on tournaments for select using (true);
create policy "tournaments_insert"   on tournaments for insert with check (is_super_admin(auth.uid()));
create policy "tournaments_update"   on tournaments for update using (is_tournament_organizer(id, auth.uid()));
create policy "tournaments_delete"   on tournaments for delete using (is_super_admin(auth.uid()));


-- ---- tournament_admins ----  (organizers manage scorers; super-admin manages organizers)
drop policy if exists "ta_select" on tournament_admins;
drop policy if exists "ta_modify" on tournament_admins;
create policy "ta_select" on tournament_admins for select using (true);
create policy "ta_modify" on tournament_admins
  for all using (
    is_super_admin(auth.uid())
    or (
      is_tournament_organizer(tournament_id, auth.uid())
      and role = 'scorer'
    )
  )
  with check (
    is_super_admin(auth.uid())
    or (
      is_tournament_organizer(tournament_id, auth.uid())
      and role = 'scorer'
    )
  );


-- ---- teams ----  (public read; organizer writes)
drop policy if exists "teams_read"   on teams;
drop policy if exists "teams_write"  on teams;
create policy "teams_read"  on teams for select using (true);
create policy "teams_write" on teams for all
  using (is_tournament_organizer(tournament_id, auth.uid()))
  with check (is_tournament_organizer(tournament_id, auth.uid()));


-- ---- players ----  (public read; only super-admins or organizers of any
--                    tournament can create/update; super-admin only for delete
--                    to protect cross-tournament history. Scorers and roleless
--                    auth users have no write access — the registry stays curated.)
drop policy if exists "players_read"           on players;
drop policy if exists "players_insert_admin"   on players;
drop policy if exists "players_update_admin"   on players;
drop policy if exists "players_delete_super"   on players;
create policy "players_read" on players for select using (true);
create policy "players_insert_admin" on players for insert
  with check (
    auth.uid() is not null
    and (
      is_super_admin(auth.uid())
      or exists (
        select 1 from tournament_admins
        where user_id = auth.uid() and role = 'organizer'
      )
    )
  );
create policy "players_update_admin" on players for update
  using (
    is_super_admin(auth.uid())
    or exists (
      select 1 from tournament_admins
      where user_id = auth.uid() and role = 'organizer'
    )
  );
create policy "players_delete_super" on players for delete
  using (is_super_admin(auth.uid()));


-- ---- team_players ----  (organizer of the team's tournament)
drop policy if exists "tp_read"  on team_players;
drop policy if exists "tp_write" on team_players;
create policy "tp_read"  on team_players for select using (true);
create policy "tp_write" on team_players for all
  using (
    is_tournament_organizer(
      (select tournament_id from teams where id = team_players.team_id),
      auth.uid()
    )
  )
  with check (
    is_tournament_organizer(
      (select tournament_id from teams where id = team_players.team_id),
      auth.uid()
    )
  );


-- ---- matches ----  (public read; organizer writes)
drop policy if exists "matches_read"  on matches;
drop policy if exists "matches_write" on matches;
create policy "matches_read"  on matches for select using (true);
create policy "matches_write" on matches for all
  using (is_tournament_organizer(tournament_id, auth.uid()))
  with check (is_tournament_organizer(tournament_id, auth.uid()));


-- ---- match_players ----
drop policy if exists "mp_read"  on match_players;
drop policy if exists "mp_write" on match_players;
create policy "mp_read"  on match_players for select using (true);
create policy "mp_write" on match_players for all
  using (
    is_tournament_organizer(tournament_id_for_match(match_id), auth.uid())
  )
  with check (
    is_tournament_organizer(tournament_id_for_match(match_id), auth.uid())
  );


-- ---- innings ----
drop policy if exists "innings_read"  on innings;
drop policy if exists "innings_write" on innings;
create policy "innings_read"  on innings for select using (true);
create policy "innings_write" on innings for all
  using (
    is_tournament_admin(tournament_id_for_match(match_id), auth.uid())
  )
  with check (
    is_tournament_admin(tournament_id_for_match(match_id), auth.uid())
  );


-- ---- balls ----  (any tournament admin/scorer can write; everyone can read non-voided)
drop policy if exists "balls_read"  on balls;
drop policy if exists "balls_write" on balls;
create policy "balls_read" on balls for select using (true);
create policy "balls_write" on balls for all
  using (
    is_tournament_admin(tournament_id_for_innings(innings_id), auth.uid())
  )
  with check (
    is_tournament_admin(tournament_id_for_innings(innings_id), auth.uid())
  );


-- ---- audit_log ----  (organizers + super admin can read; writes happen via service role/triggers)
drop policy if exists "audit_read" on audit_log;
create policy "audit_read" on audit_log for select using (
  is_super_admin(auth.uid())
  or (tournament_id is not null and is_tournament_organizer(tournament_id, auth.uid()))
);


-- =====================================================================
-- REALTIME PUBLICATION
--   Enables WebSocket subscriptions on these tables. Spectator pages
--   should still prefer cached HTTP for free-tier connection limits.
-- =====================================================================
alter publication supabase_realtime add table balls;
alter publication supabase_realtime add table innings;
alter publication supabase_realtime add table matches;


-- =====================================================================
-- STORAGE BUCKETS  (uncomment to create via SQL; or do in dashboard)
-- =====================================================================
-- insert into storage.buckets (id, name, public) values
--   ('tournament-logos', 'tournament-logos', true),
--   ('team-logos',       'team-logos',       true),
--   ('player-photos',    'player-photos',    true),
--   ('match-banners',    'match-banners',    true)
-- on conflict (id) do nothing;


-- =====================================================================
-- DONE
--
-- Next manual step after first signup:
--   update profiles set is_super_admin = true where id = '<your-user-uuid>';
-- =====================================================================
