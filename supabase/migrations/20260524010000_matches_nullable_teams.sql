-- Allow team_a_id / team_b_id to be NULL on `matches` rows.
--
-- Use case: playoff bracket scheduling. Once the league phase
-- completes, the organizer (or the schedule-playoffs script) can
-- pre-create Qualifier 2 + Final match rows so spectators see them
-- in the upcoming-matches list. The actual teams aren't known yet
-- — Q2's team_a depends on Q1's loser, Final's team_b depends on
-- Q2's winner, etc. Storing NULL until the upstream match
-- completes (then UPDATE'ing in the resolver) is the cleanest
-- model: no sentinel team rows, no hidden data, no special-cases
-- in the standings / squad queries.
--
-- Group / league matches stay populated as before — the
-- create-match form requires teams for any non-playoff stage, and
-- the start-match / scoring pipeline gates on both teams being
-- non-null. So nullability is permitted but not encouraged.
--
-- Idempotent: ALTER … DROP NOT NULL is a no-op if the column is
-- already nullable.

alter table matches alter column team_a_id drop not null;
alter table matches alter column team_b_id drop not null;

comment on column matches.team_a_id is
  'Team A. Nullable for playoff matches scheduled before their teams are known (e.g. Q2 / Final pre-bracket); populated via the playoff resolver when an upstream match completes.';
comment on column matches.team_b_id is
  'Team B. See team_a_id comment.';
