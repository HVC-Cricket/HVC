-- =====================================================================
-- 2026-05-16 — Team admins
-- ---------------------------------------------------------------------
-- Per-team admin role. Sits between "tournament organizer" (manages
-- everything in a tournament) and "scorer" (records balls).
--
-- A team admin can:
--   • update their team's metadata (logo_url, name, short_name)
--   • add players to their team's roster — but only if the player is
--     not already on ANOTHER team in the same tournament (enforced in
--     the addPlayerToTeam Server Action)
--   • remove players from their team's roster
--
-- A team admin canNOT:
--   • delete the team
--   • create new teams
--   • edit other teams in the same tournament
--   • record ball-by-ball (scorers do that)
--
-- Tournament organizers + super admins are unaffected — they can still
-- manage every team in their tournament.
-- =====================================================================

create table if not exists team_admins (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  added_by    uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (team_id, user_id)
);

create index if not exists idx_team_admins_team on team_admins(team_id);
create index if not exists idx_team_admins_user on team_admins(user_id);

alter table team_admins enable row level security;

-- ---------------------------------------------------------------------
-- Helper: is the given user a team admin for the given team?
-- SECURITY DEFINER avoids RLS recursion when called from inside other
-- policies on `teams` / `team_players`.
-- ---------------------------------------------------------------------
create or replace function is_team_admin(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select true from team_admins
    where team_id = p_team_id and user_id = p_user_id
    limit 1
  ), false);
$$;

-- ---------------------------------------------------------------------
-- RLS on team_admins itself
-- ---------------------------------------------------------------------
drop policy if exists "team_admins_select" on team_admins;
create policy "team_admins_select" on team_admins
  for select using (true);

-- Manage rows (assign / remove): super-admin or tournament organizer
-- of the team's tournament. is_tournament_organizer() already returns
-- true for super admins.
drop policy if exists "team_admins_write" on team_admins;
create policy "team_admins_write" on team_admins for all
  using (
    is_tournament_organizer(
      (select tournament_id from teams where id = team_admins.team_id),
      auth.uid()
    )
  )
  with check (
    is_tournament_organizer(
      (select tournament_id from teams where id = team_admins.team_id),
      auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- Extend teams_write so team admins of that team can update too.
-- Tournament organizers + super admins remain unaffected.
-- ---------------------------------------------------------------------
drop policy if exists "teams_write" on teams;
create policy "teams_write" on teams for all
  using (
    is_tournament_organizer(tournament_id, auth.uid())
    or is_team_admin(id, auth.uid())
  )
  with check (
    is_tournament_organizer(tournament_id, auth.uid())
    or is_team_admin(id, auth.uid())
  );

-- ---------------------------------------------------------------------
-- Extend team_players write so team admins can add/remove their own
-- roster. The "player not on another team in the same tournament"
-- guard for team-admin writes is enforced application-side in the
-- addPlayerToTeam Server Action — RLS can't express cross-row checks
-- across teams cleanly.
-- ---------------------------------------------------------------------
drop policy if exists "tp_write" on team_players;
create policy "tp_write" on team_players for all
  using (
    is_tournament_organizer(
      (select tournament_id from teams where id = team_players.team_id),
      auth.uid()
    )
    or is_team_admin(team_players.team_id, auth.uid())
  )
  with check (
    is_tournament_organizer(
      (select tournament_id from teams where id = team_players.team_id),
      auth.uid()
    )
    or is_team_admin(team_players.team_id, auth.uid())
  );
