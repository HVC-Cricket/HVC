-- =====================================================================
-- 2026-05-13 — `balls.counts_for_innings_total`
-- ---------------------------------------------------------------------
-- HVC Cat 1 / Cat 3 special-over rule: a special batter who's already
-- been dismissed once in their special over keeps batting for the rest
-- of the over (cat_special_strike = "stay"). Repeat dismissals still
-- credit the bowler — the bowler's column shows "3" if they bowl the
-- Cat 1 batter three times — but the team's innings wicket total only
-- counts the FIRST dismissal.
--
-- Until this migration, `innings.total_wickets` was recomputed by
-- counting every ball with `is_wicket = true`, so the team total grew
-- with each repeat dismissal. The new column lets `recordBall` flag
-- repeat-dismissal rows; the recompute filters them out.
--
-- Bowler stats are unaffected — they're computed in TS from `balls`
-- rows directly and key off `wicket_type`, not this flag.
--
-- Idempotent: `add column if not exists` + `create or replace function`.
-- =====================================================================

alter table balls
  add column if not exists counts_for_innings_total boolean not null default true;

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
        and counts_for_innings_total = true
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
