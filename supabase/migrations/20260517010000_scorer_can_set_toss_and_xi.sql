-- =====================================================================
-- 2026-05-17 — Scorers can set toss + pick XI
-- ---------------------------------------------------------------------
-- The score page's pre-match checklist surfaces toss + Pick XI to any
-- tournament admin (organizer OR scorer), but the underlying RLS on
-- `matches` and `match_players` was organizer-only — so a scorer who
-- clicked "Pick XI" hit the requireOrganizer redirect and bounced to
-- the home page. The app-level guards have been loosened to
-- `requireTournamentAdmin`; this migration loosens the matching RLS
-- so the writes actually land.
--
-- `matches` is split so scorers can only UPDATE (covers toss); INSERT
-- and DELETE stay organizer-only so scorers can't fabricate or wipe
-- matches via the direct REST API. `match_players` follows the same
-- pattern as `innings` / `balls` (admin for everything) since XI
-- changes belong to the live-match workflow scorers already own.
-- =====================================================================

-- ---- matches ----
drop policy if exists "matches_write" on matches;

create policy "matches_insert" on matches for insert
  with check (is_tournament_organizer(tournament_id, auth.uid()));

create policy "matches_update" on matches for update
  using (is_tournament_admin(tournament_id, auth.uid()))
  with check (is_tournament_admin(tournament_id, auth.uid()));

create policy "matches_delete" on matches for delete
  using (is_tournament_organizer(tournament_id, auth.uid()));

-- ---- match_players ----
drop policy if exists "mp_write" on match_players;
create policy "mp_write" on match_players for all
  using (
    is_tournament_admin(tournament_id_for_match(match_id), auth.uid())
  )
  with check (
    is_tournament_admin(tournament_id_for_match(match_id), auth.uid())
  );
