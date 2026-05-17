-- =====================================================================
-- 2026-05-17 — Lift the innings_number ≤ 4 cap
-- ---------------------------------------------------------------------
-- A tied super over re-supers per cricket rules (no fixed cap — repeated
-- until decided). The schema's `innings_number between 1 and 4` check
-- meant the 2nd super over insert hit:
--   new row for relation "innings" violates check constraint
--   "innings_innings_number_check"
-- because innings 3+4 are the first super-over pair, 5+6 the second,
-- 7+8 the third, and so on. The TS engine + `startSuperOverInnings`
-- action were already written for this chain (`min(3)` schema, pair
-- look-up by `targetInnings - 2`); only the DB constraint was blocking.
-- =====================================================================

alter table innings drop constraint if exists innings_innings_number_check;
alter table innings add  constraint innings_innings_number_check
  check (innings_number >= 1);
