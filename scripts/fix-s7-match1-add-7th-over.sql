-- =====================================================================
-- S7 Match #1 (CC vs WK) — was mis-configured as a 6-over match but the
-- two teams actually played a 7th over. The 7th-over scoring was kept
-- on paper. This script:
--
--   1. Lifts matches.overs_per_innings from 6 → 7.
--   2. Temporarily flips both innings is_complete=false so the
--      balls_check_innings_open trigger lets us insert into them.
--   3. Inserts the 12 new balls (6 per innings) with correct
--      striker/non-striker rotation derived from the last legal ball
--      of over 6 in each innings.
--   4. Restores is_complete=true and ended_at on both innings.
--   5. Calls recompute_innings explicitly (the per-ball trigger does
--      it too, but redundant is fine).
--
-- After-state totals (cross-checked with the user's instructions):
--   • Innings 1 (WK bat): 57 → 67  (over 7 runs: 1+6+0+0+0+3 = 10)
--   • Innings 2 (CC bat): 44 → 54  (over 7 runs: 0+4+0+0+6+0 = 10)
--   • Win margin: WK won by 13 runs  (unchanged — coincidentally 67−54=13
--     is the same as the pre-change 57−44=13, so winner_id +
--     win_margin on matches don't need updating).
--   • NRR recomputes server-side from innings.total_runs +
--     total_legal_balls + matches.overs_per_innings; will refresh on
--     next render with the corrected 7-over span.
--
-- Strike rotation deduced from last ball of over 6:
--   • Innings 1: striker A. Kaushik hit 4 (even) on 6.6 → over-end swap
--     → over 7 striker = Guruprasad R, non-striker = A. Kaushik.
--   • Innings 2: striker Aniruddha hit 1 (odd) on 6.6 → swap after ball
--     (Prasanna onto strike), then over-end swap (Aniruddha back)
--     → over 7 striker = Aniruddha, non-striker = Prasanna.
-- =====================================================================

begin;

do $$
declare
  match_uuid uuid := '170208e1-fae4-492c-9029-5eda2018f5a4';
  inn1_id uuid;
  inn2_id uuid;
  inn1_started_at timestamptz;
  inn2_started_at timestamptz;
  inn1_last_scored_at timestamptz;
  inn2_last_scored_at timestamptz;
  inn1_legal_balls int;
  inn2_legal_balls int;
  scored_by_user uuid;

  -- Players (resolved by ID for safety + clarity)
  guruprasad_r uuid := '9d962480-8a62-4913-83de-d66a9e76b362'; -- WK captain
  akshay_k     uuid := 'ab35a095-be74-417e-865f-54249105ad8c'; -- WK
  srikanth_tk  uuid := '7d00707c-3880-42e1-aa54-dcf83404c923'; -- CC, over-7 bowler in innings 1
  srisha       uuid := 'b88b88cb-2265-4939-891b-e2e4e3c469bb'; -- WK (ಶ್ರೀಶ), over-7 bowler in innings 2
  aniruddha_v  uuid;
  prasanna_p   uuid;
begin
  -- ── 0. Find both innings + the players who'd be at the crease for
  --       over 7 of innings 2 (innings 1 is hardcoded above — verified
  --       via the diagnostic). For innings 2 we look up the striker
  --       and non-striker dynamically off the last ball, since the
  --       schema swap a few hours ago means those player_ids are now
  --       canonical and shouldn't be re-encoded.
  select id, started_at into inn1_id, inn1_started_at
    from innings where match_id = match_uuid and innings_number = 1;
  select id, started_at into inn2_id, inn2_started_at
    from innings where match_id = match_uuid and innings_number = 2;
  if inn1_id is null or inn2_id is null then
    raise exception 'Could not find both innings for match %', match_uuid;
  end if;

  -- Innings 2 last ball: striker = Aniruddha, ns = Prasanna (after the
  -- 1-run-then-over-end double-swap). Pull directly from the ball row
  -- so we don't have to re-derive in the script.
  select batter_id, non_striker_id into aniruddha_v, prasanna_p
    from balls
    where innings_id = inn2_id
      and is_voided = false
      and over_number = 6
      and ball_in_over = 6
    limit 1;
  if aniruddha_v is null or prasanna_p is null then
    raise exception 'Could not resolve striker/non-striker for innings 2 from over 6.6';
  end if;

  -- Scorer attribution: any super-admin profile. Pavan or Sudharshan.
  select id into scored_by_user
    from profiles
    where is_super_admin = true
    order by created_at asc
    limit 1;
  if scored_by_user is null then
    raise exception 'No super-admin profile found to attribute scored_by';
  end if;

  select total_legal_balls into inn1_legal_balls from innings where id = inn1_id;
  select total_legal_balls into inn2_legal_balls from innings where id = inn2_id;
  select max(scored_at) into inn1_last_scored_at from balls where innings_id = inn1_id and is_voided = false;
  select max(scored_at) into inn2_last_scored_at from balls where innings_id = inn2_id and is_voided = false;
  inn1_last_scored_at := coalesce(inn1_last_scored_at, inn1_started_at, now());
  inn2_last_scored_at := coalesce(inn2_last_scored_at, inn2_started_at, now());

  raise notice 'Before — innings 1: % legal balls, last ball %; innings 2: % legal balls, last ball %',
    inn1_legal_balls, inn1_last_scored_at, inn2_legal_balls, inn2_last_scored_at;

  -- ── 1. Lift the match to 7 overs. ──
  update matches set overs_per_innings = 7 where id = match_uuid;

  -- ── 2. Re-open both innings so balls_check_innings_open lets us
  --       insert. Preserve their ended_at values for later restore. ──
  update innings set is_complete = false where id in (inn1_id, inn2_id);

  -- ── 3. Insert over 7 — innings 1 (WK batting, Srikanth T K bowling). ──
  -- Ball 1: Guruprasad 1 run  → swap (odd)
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn1_id, 7, 1, inn1_legal_balls + 1,
    guruprasad_r, akshay_k, srikanth_tk,
    1, 0, null, false,
    scored_by_user, inn1_last_scored_at + interval '1 second'
  );

  -- Ball 2: Akshay 6        → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn1_id, 7, 2, inn1_legal_balls + 2,
    akshay_k, guruprasad_r, srikanth_tk,
    6, 0, null, false,
    scored_by_user, inn1_last_scored_at + interval '2 second'
  );

  -- Ball 3: Akshay 0        → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn1_id, 7, 3, inn1_legal_balls + 3,
    akshay_k, guruprasad_r, srikanth_tk,
    0, 0, null, false,
    scored_by_user, inn1_last_scored_at + interval '3 second'
  );

  -- Ball 4: Akshay 0        → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn1_id, 7, 4, inn1_legal_balls + 4,
    akshay_k, guruprasad_r, srikanth_tk,
    0, 0, null, false,
    scored_by_user, inn1_last_scored_at + interval '4 second'
  );

  -- Ball 5: Akshay 0        → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn1_id, 7, 5, inn1_legal_balls + 5,
    akshay_k, guruprasad_r, srikanth_tk,
    0, 0, null, false,
    scored_by_user, inn1_last_scored_at + interval '5 second'
  );

  -- Ball 6: Akshay 3        → swap (innings then ends)
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn1_id, 7, 6, inn1_legal_balls + 6,
    akshay_k, guruprasad_r, srikanth_tk,
    3, 0, null, false,
    scored_by_user, inn1_last_scored_at + interval '6 second'
  );

  -- ── 4. Insert over 7 — innings 2 (CC batting, Srisha bowling). ──
  -- All on-strike balls by Aniruddha; only the 6 is "even", everything
  -- else is 0 — Aniruddha keeps strike all six.
  -- Ball 1: Aniruddha 0     → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn2_id, 7, 1, inn2_legal_balls + 1,
    aniruddha_v, prasanna_p, srisha,
    0, 0, null, false,
    scored_by_user, inn2_last_scored_at + interval '1 second'
  );

  -- Ball 2: Aniruddha 4     → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn2_id, 7, 2, inn2_legal_balls + 2,
    aniruddha_v, prasanna_p, srisha,
    4, 0, null, false,
    scored_by_user, inn2_last_scored_at + interval '2 second'
  );

  -- Ball 3: Aniruddha 0     → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn2_id, 7, 3, inn2_legal_balls + 3,
    aniruddha_v, prasanna_p, srisha,
    0, 0, null, false,
    scored_by_user, inn2_last_scored_at + interval '3 second'
  );

  -- Ball 4: Aniruddha 0     → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn2_id, 7, 4, inn2_legal_balls + 4,
    aniruddha_v, prasanna_p, srisha,
    0, 0, null, false,
    scored_by_user, inn2_last_scored_at + interval '4 second'
  );

  -- Ball 5: Aniruddha 6     → no swap
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn2_id, 7, 5, inn2_legal_balls + 5,
    aniruddha_v, prasanna_p, srisha,
    6, 0, null, false,
    scored_by_user, inn2_last_scored_at + interval '5 second'
  );

  -- Ball 6: Aniruddha 0     → no swap (innings then ends — chase failed)
  insert into balls (
    innings_id, over_number, ball_in_over, legal_ball_seq,
    batter_id, non_striker_id, bowler_id,
    runs_off_bat, extras, extra_type, is_wicket,
    scored_by, scored_at
  ) values (
    inn2_id, 7, 6, inn2_legal_balls + 6,
    aniruddha_v, prasanna_p, srisha,
    0, 0, null, false,
    scored_by_user, inn2_last_scored_at + interval '6 second'
  );

  -- ── 5. Close both innings again. ──
  -- The trg_balls_recompute_innings trigger has already updated totals
  -- per-row during the inserts, but call once more explicitly to be
  -- doubly safe (recompute is idempotent).
  perform recompute_innings(inn1_id);
  perform recompute_innings(inn2_id);

  update innings set
    is_complete = true,
    ended_at    = coalesce(ended_at, now())
  where id in (inn1_id, inn2_id);

  -- ── 6. Sanity-check the totals. ──
  declare
    inn1_total int; inn2_total int;
    inn1_legal int; inn2_legal int;
  begin
    select total_runs, total_legal_balls into inn1_total, inn1_legal
      from innings where id = inn1_id;
    select total_runs, total_legal_balls into inn2_total, inn2_legal
      from innings where id = inn2_id;
    raise notice 'After — innings 1: % runs / % legal balls; innings 2: % runs / % legal balls',
      inn1_total, inn1_legal, inn2_total, inn2_legal;

    if inn1_total <> 67 then
      raise exception 'Innings 1 expected 67, got %', inn1_total;
    end if;
    if inn2_total <> 54 then
      raise exception 'Innings 2 expected 54, got %', inn2_total;
    end if;
    if inn1_legal <> 42 then
      raise exception 'Innings 1 expected 42 legal balls, got %', inn1_legal;
    end if;
    if inn2_legal <> 42 then
      raise exception 'Innings 2 expected 42 legal balls, got %', inn2_legal;
    end if;
  end;
end $$;

commit;
