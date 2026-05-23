-- =====================================================================
-- Swap Srikanth Krishnamurthy ↔ Srikanth T K in Season 7 data only.
--
-- Why: S7 squad assignments were entered the wrong way around. The
-- real Srikanth T K (id=7d00707c, has linked account, plays for CC in
-- S4/S5/S6) ended up in the KW squad, and the real Srikanth
-- Krishnamurthy (id=53df43b5, wicket-keeper, plays for Hoysala in
-- S4/S5/S6) ended up in the CC squad. The scorer then correctly
-- selected "whichever Srikanth is in the squad" for each ball, but
-- the squad itself was wrong — so the 92-run S7 contribution sitting
-- under "Srikanth Krishnamurthy" is actually Srikanth T K's runs.
--
-- Historical S1–S6 data is already correct under each ID (each
-- person's records have always tracked under their own player_id).
-- DO NOT touch historical_match_batting / historical_match_bowling /
-- historical_tournament_mvp / historical_match_fall_of_wickets — they
-- would corrupt 6 seasons of correct attribution.
--
-- Approach: swap player_id wherever they appear inside S7's matches
-- (balls + match_players) and S7's teams (team_players). Names /
-- photos / linked_user_id stay attached to each player_id row, so
-- after the swap each player ROW reads correctly:
--   id=53df43b5 "Srikanth Krishnamurthy" → on KW, 14-ish S7 runs +
--                                          unchanged Hoysala history
--   id=7d00707c "Srikanth T K"           → on CC, 92-ish S7 runs +
--                                          unchanged CC history
--
-- To run against prod: paste this whole file into the Supabase SQL
-- editor (project cxysyglwooqmzcfvtmyl). Read the counts the asserts
-- print, then COMMIT. If anything looks off, ROLLBACK.
-- =====================================================================

begin;

-- ───────────────────────────────────────────────────────────
-- Constants — the two player IDs + the S7 tournament ID.
-- ───────────────────────────────────────────────────────────
do $$
declare
  player_a uuid := '53df43b5-38b1-48ed-bb73-16442bd767b6'; -- Srikanth Krishnamurthy (currently on CC, should be KW)
  player_b uuid := '7d00707c-3880-42e1-aa54-dcf83404c923'; -- Srikanth T K           (currently on KW, should be CC)
  tournament_uuid uuid := '4826feda-2246-4759-ba53-8d8e1701ba25'; -- HVC - SEASON 7
  s7_match_ids uuid[];
  s7_innings_ids uuid[];
  s7_team_ids uuid[];
  affected int;
begin
  -- ── 1. Sanity-check the names so we don't swap the wrong players. ──
  perform 1 from players where id = player_a and display_name = 'Srikanth Krishnamurthy';
  if not found then
    raise exception 'Player A (id=%) is not named "Srikanth Krishnamurthy" — aborting.', player_a;
  end if;
  perform 1 from players where id = player_b and display_name = 'Srikanth T K';
  if not found then
    raise exception 'Player B (id=%) is not named "Srikanth T K" — aborting.', player_b;
  end if;

  -- ── 2. Collect S7's match + innings + team IDs into arrays. ──
  s7_match_ids := array(
    select id from matches where tournament_id = tournament_uuid
  );
  s7_innings_ids := array(
    select id from innings where match_id = any(s7_match_ids)
  );
  s7_team_ids := array(
    select id from teams where tournament_id = tournament_uuid
  );
  raise notice 'S7 scope: % matches, % innings, % teams',
    array_length(s7_match_ids, 1),
    array_length(s7_innings_ids, 1),
    array_length(s7_team_ids, 1);

  -- ── 3. Swap inside balls (S7 innings only). One CASE per column. ──
  -- Five player columns. CASE evaluates per row so the swap is atomic
  -- per UPDATE (no half-state where both rows briefly hold the same id).
  update balls set batter_id = case batter_id
    when player_a then player_b
    when player_b then player_a
  end
  where batter_id in (player_a, player_b)
    and innings_id = any(s7_innings_ids);
  get diagnostics affected = row_count;
  raise notice 'balls.batter_id swapped: % rows', affected;

  update balls set non_striker_id = case non_striker_id
    when player_a then player_b
    when player_b then player_a
  end
  where non_striker_id in (player_a, player_b)
    and innings_id = any(s7_innings_ids);
  get diagnostics affected = row_count;
  raise notice 'balls.non_striker_id swapped: % rows', affected;

  update balls set bowler_id = case bowler_id
    when player_a then player_b
    when player_b then player_a
  end
  where bowler_id in (player_a, player_b)
    and innings_id = any(s7_innings_ids);
  get diagnostics affected = row_count;
  raise notice 'balls.bowler_id swapped: % rows', affected;

  update balls set fielder_id = case fielder_id
    when player_a then player_b
    when player_b then player_a
  end
  where fielder_id in (player_a, player_b)
    and innings_id = any(s7_innings_ids);
  get diagnostics affected = row_count;
  raise notice 'balls.fielder_id swapped: % rows', affected;

  update balls set player_out_id = case player_out_id
    when player_a then player_b
    when player_b then player_a
  end
  where player_out_id in (player_a, player_b)
    and innings_id = any(s7_innings_ids);
  get diagnostics affected = row_count;
  raise notice 'balls.player_out_id swapped: % rows', affected;

  -- ── 4. Swap in match_players (S7 matches only). ──
  update match_players set player_id = case player_id
    when player_a then player_b
    when player_b then player_a
  end
  where player_id in (player_a, player_b)
    and match_id = any(s7_match_ids);
  get diagnostics affected = row_count;
  raise notice 'match_players swapped: % rows', affected;

  -- ── 5. Swap in team_players (S7 teams only). ──
  -- Unique constraint is (team_id, player_id). Before swap:
  --   (CC, player_a), (KW, player_b)
  -- After swap:
  --   (CC, player_b), (KW, player_a)
  -- All four pairs are distinct, so no collision at any intermediate
  -- per-row check during the UPDATE.
  update team_players set player_id = case player_id
    when player_a then player_b
    when player_b then player_a
  end
  where player_id in (player_a, player_b)
    and team_id = any(s7_team_ids);
  get diagnostics affected = row_count;
  raise notice 'team_players swapped: % rows', affected;

  -- ── 6. Recompute innings totals for every S7 innings the two
  --       players touched, so live cached aggregates (total_runs etc.)
  --       refresh against the new attribution. The recompute is
  --       idempotent — running it on innings they didn't touch is
  --       harmless, just unnecessary, so we scope to S7 innings only.
  perform recompute_innings(i_id)
  from unnest(s7_innings_ids) as i_id;
  raise notice 'recompute_innings: % innings', array_length(s7_innings_ids, 1);

  raise notice '— Swap complete. Review the row counts above. If anything looks wrong, ROLLBACK; otherwise COMMIT.';
end $$;

-- ⚠ COMMIT only runs if the DO block above completed without raising
-- an exception. The DO block validates the two names against the IDs
-- before any UPDATE — if either name doesn't match, it raises and the
-- whole transaction rolls back automatically.
commit;
