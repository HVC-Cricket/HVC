-- =====================================================================
-- 2026-05-12 — Allow ball_in_over = 0 on the balls table
-- ---------------------------------------------------------------------
-- The engine semantic for `ball_in_over` is "legal balls completed in
-- the current over so far", which starts at 0. A wide / no-ball bowled
-- before the first legal delivery of an over (or innings) is recorded
-- with ball_in_over = 0. The previous constraint required 1..6, which
-- meant the first ball of an innings being a wide failed insertion with
--   new row for relation "balls" violates check constraint
--   "balls_ball_in_over_range"
--
-- Relaxes the range to 0..6. db.sql is updated to match.
-- Idempotent — drops the old constraint before re-adding.
-- =====================================================================

alter table balls drop constraint if exists balls_ball_in_over_range;

alter table balls
  add constraint balls_ball_in_over_range
  check (ball_in_over between 0 and 6);
