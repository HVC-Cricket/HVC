-- =====================================================================
-- 2026-05-16 — add `round_robin_playoff_final` to tournaments.format
-- ---------------------------------------------------------------------
-- IPL-style three-phase tournaments: every team plays every other team
-- in a round-robin, top finishers go to a playoff (Q1 / Q2 /
-- Eliminator), and the playoff winners contest a single Final. Was
-- previously approximated via "league" or "group_then_knockout"; the
-- new value lets the format pill on the tournament header and the
-- match-stage selection logic differentiate.
--
-- Idempotent — drops the old constraint before re-adding.
-- =====================================================================

alter table tournaments
  drop constraint if exists tournaments_format_check;

alter table tournaments
  add constraint tournaments_format_check
  check (
    format in (
      'league',
      'knockout',
      'group_then_knockout',
      'round_robin_playoff_final'
    )
  );
