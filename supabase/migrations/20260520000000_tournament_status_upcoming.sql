-- =====================================================================
-- 2026-05-20 — extend tournaments_status_check with 'upcoming'
-- ---------------------------------------------------------------------
-- Admins want a status between 'draft' and 'active' for a tournament
-- that's announced + scheduled but no match has been played yet. UI:
-- 'Upcoming' badge on the tournament detail header, hero strip on the
-- home page until the first match goes live.
--
-- `deriveTournamentStatus` (src/lib/constants/tournament.ts) flips the
-- derived value back to 'active' the moment any match reaches live /
-- innings_break, so an admin who sets 'upcoming' doesn't need to
-- remember to flip it manually when scoring starts.
--
-- `tournaments.status` is gated by a CHECK constraint (not a Postgres
-- enum), so this is a drop + re-add. Idempotent.
-- =====================================================================

alter table tournaments
  drop constraint if exists tournaments_status_check;

alter table tournaments
  add constraint tournaments_status_check
  check (
    status in (
      'draft',
      'upcoming',
      'active',
      'completed',
      'archived'
    )
  );
