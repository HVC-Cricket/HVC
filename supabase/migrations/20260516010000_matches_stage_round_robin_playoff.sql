-- =====================================================================
-- 2026-05-16 — extend matches.stage with playoff variants
-- ---------------------------------------------------------------------
-- The new `round_robin_playoff_final` tournament format uses IPL-style
-- playoffs: Qualifier 1, Eliminator, Qualifier 2, Final. The existing
-- `qualifier` value covered one generic qualifier slot — fine for the
-- knockout / group-then-knockout formats but it can't represent the
-- three distinct playoff matches in IPL-style.
--
-- Adds three new allowed stage values: `qualifier_1`, `eliminator`,
-- `qualifier_2`. The match-creation / edit forms decide which subset
-- to surface per tournament format.
--
-- Idempotent — drops + re-adds the constraint.
-- =====================================================================

alter table matches
  drop constraint if exists matches_stage_check;

alter table matches
  add constraint matches_stage_check
  check (
    stage in (
      'group',
      'qualifier',
      'qualifier_1',
      'eliminator',
      'qualifier_2',
      'quarter',
      'semi',
      'final',
      'exhibition'
    )
  );
