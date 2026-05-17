# HVC Scoring — Auto Player-of-the-Match Formula

> Last revised: 2026-05-11 (historical-tournament POTM override noted 2026-05-17).
> Source of truth: `src/app/matches/[matchId]/player-of-match/match-awards.tsx`, function `computePerformances`.
> Used wherever a completed match doesn't yet have an admin-confirmed `matches.player_of_match_id` value.

> **Historical (CricHeroes-imported) tournaments only — the *Tournament*-level POTM card on the completed-tournament hero is overridden by `historical_tournament_mvp` rank 1**, not derived from this per-match formula. See HANDOFF §17. The per-match POTM formula below is still the source of truth for individual matches scored in our app, and for the tournament-POTM tie-break on tournaments scored in our app.

## Why we have a formula at all

In real cricket, Player of the Match is a judgment call. A 25-ball cameo at the death in a chase often deserves it more than a slow 50, and no algorithm captures that perfectly. So the formula's job is **not** to replace the admin — it's to:

1. Surface a sensible default the moment a match ends, so spectators see *something* on the public page without waiting on the organiser.
2. Give the admin a ranked list of the top performers so the decision is one click instead of a hunt through the scorecard.
3. Be transparent — every point is auditable by hand if anyone questions a pick.

Tournament admins can override the auto-pick at any time. The "Use auto-pick" button clears the column and reverts to the algorithm.

## Design constraints

The formula is tuned for **HVC's 7-over box-cricket format**, which differs from T20 in three important ways:

| Factor | T20 | HVC 7-over |
|---|---|---|
| Innings length | ~120 balls | ~42 balls |
| Par score | 160-180 | 50-70 |
| Typical wickets per innings | 6-8 | 2-5 |
| Best individual score | 80-100 | 30-50 |
| Best individual figures | 3-for | 2- to 3-for |

That means wickets are scarcer (so each one is more valuable), 50s are rarer (so they get a bigger bonus), and a 4-wicket haul is genuinely match-winning (so it earns the top tier).

The formula uses **flat points** (no multipliers, no context-based weighting). Every threshold is a literal in the function. If a real match throws up an unfair pick, change one number and ship a patch — no schema, no migration, no admin intervention needed.

## The formula

### Batting

| Action | Points |
|---|---|
| Each run | **+1** |
| Each four | **+2** bonus |
| Each six | **+5** bonus |
| Runs ≥ 25 | **+6** milestone |
| Runs ≥ 50 | **+20** milestone (replaces the +6) |
| Runs ≥ 75 | **+40** milestone (replaces the +20) |
| Strike rate ≥ 120 (min 6 balls faced) | **+4** |
| Strike rate ≥ 150 (min 6 balls faced) | **+8** (replaces the +4) |
| Strike rate ≥ 200 (min 6 balls faced) | **+12** (replaces the +8) |
| Not out with ≥ 15 runs | **+5** finisher bonus |
| Duck — out for 0 having faced ≥ 1 ball | **−3** penalty |

Milestone and strike-rate bonuses are **tiered, not cumulative** — only the highest one applies. A 75 doesn't get +6 + +20 + +40; it gets +40.

The 6-ball minimum on strike-rate stops a 6(2) cameo from earning the SR bonus. The 15-run minimum on the not-out bonus stops a 0\* nightwatchman situation from earning it.

### Bowling

| Action | Points |
|---|---|
| Each wicket (bowler-credited types only)¹ | **+20** |
| 2-wicket haul | **+5** bonus |
| 3-wicket haul | **+15** bonus (replaces the +5) |
| 4+-wicket haul | **+30** bonus (replaces the +15) |
| Each maiden over² | **+12** |
| Each dot ball³ | **+1** |
| Economy < 4 (min 6 legal balls) | **+12** |
| Economy < 5 (min 6 legal balls) | **+8** (replaces the +12 if you cross the cutoff) |
| Economy < 6 (min 6 legal balls) | **+5** |
| Economy < 7 (min 6 legal balls) | **+2** |
| Economy > 12 (min 6 legal balls) | **−5** leakage penalty |

¹ Bowler-credited wickets: `bowled`, `caught`, `caught_and_bowled`, `lbw`, `stumped`, `hit_wicket`. A `run_out` is credited to the fielder, not the bowler.
² Maiden over: bowler bowled all 6 legal balls of the over AND zero runs scored in the over (no batter runs, no wides, no no-balls, no byes). Standard ICC definition.
³ Dot ball: a legal delivery (not wide / no-ball) where `runs_off_bat + extras = 0`.

### Fielding

| Action | Points |
|---|---|
| Each catch — `caught` | **+8** (fielder credited) |
| Each catch — `caught_and_bowled` | **+8** (bowler credited) |
| Each run-out — `run_out` | **+8** (fielder credited) |
| Each stumping — `stumped` | **+12** (fielder credited) |
| 3+ catches in the match | **+5** bonus |

### Team context

| Action | Points |
|---|---|
| On the winning side | **+10** |

Calibrated so it's enough to **break ties** between near-identical performances on either side, but **not enough to override** a clearly better individual contribution by a player on the losing side. A 5-wicket haul in a losing cause still wins POTM, as it should.

## Calibration spot-checks

Three reference cases I built around during the tuning pass:

### Case 1 — Winning all-rounder

Pavan: 45(28) including 1 four and 4 sixes; bowls 2 overs for 0/12 (5 dot balls); team won.

| Component | Points |
|---|---|
| Runs (45) | 45 |
| 4s (1 × +2) | 2 |
| 6s (4 × +5) | 20 |
| 25+ milestone | 6 |
| SR 160.7 (≥ 150) | 8 |
| Wickets | 0 |
| Dots (5 × +1) | 5 |
| Economy 6.0 — no bonus | 0 |
| Winning side | 10 |
| **Total** | **96** |

### Case 2 — Losing-side specialist

Virat: 0(0), bowls 3 overs for 4/8 (8 dot balls, 2 maidens), 1 catch; team lost.

| Component | Points |
|---|---|
| Wickets (4 × 20) | 80 |
| 4-wicket haul | 30 |
| Maidens (2 × 12) | 24 |
| Dots (8 × 1) | 8 |
| Economy 2.67 (< 4) | 12 |
| Catch | 8 |
| Winning side | 0 |
| **Total** | **162** |

Virat wins POTM despite the loss — correct, this is a genuinely outstanding spell.

### Case 3 — Close-finish tradeoff

Two near-identical contributions, one on each side. The winning bonus breaks the tie but doesn't overwhelm.

Player A (winner): 35(25), 1/10 (2 overs, 4 dot balls), 1 catch.

| Component | Points |
|---|---|
| Runs | 35 |
| 25+ milestone | 6 |
| SR 140 (≥ 120) | 4 |
| Wicket | 20 |
| Dots (4 × 1) | 4 |
| Econ 5.0 (< 6) | 5 |
| Catch | 8 |
| Winning side | 10 |
| **Total** | **92** |

Player B (loser): 30(20), 2/8 (2 overs, 5 dot balls).

| Component | Points |
|---|---|
| Runs | 30 |
| 25+ milestone | 6 |
| SR 150 (≥ 150) | 8 |
| Wickets (2 × 20) | 40 |
| 2-wicket haul | 5 |
| Dots (5 × 1) | 5 |
| Econ 4.0 (< 5) | 8 |
| Winning side | 0 |
| **Total** | **102** |

Player B wins POTM by 10. The judgement: B's 2/8 + 30(20) had more match impact than A's 1/10 + 35(25) — wickets are scarcer in this format, and B nearly took the match. The +10 winning-side bonus to A doesn't quite close the gap, which is exactly the calibration we want.

## Edge cases handled

- **Player who never batted** — runs/balls/fours/sixes all zero, no batting penalty applied (the duck penalty requires `balls_faced ≥ 1`).
- **Bowler who only bowled wides** — `legal_balls = 0`, economy bonuses skipped (require `legal_balls ≥ 6`).
- **Match abandoned mid-innings** — formula still works; just runs against whatever balls are in the DB. The auto-pick will reflect the partial match.
- **Tie** — the +10 winning bonus is applied to no team (both teams' `winner_id` won't match), so the formula falls back to pure individual contribution.
- **Super over** — super-over balls feed in like any other balls (they live in `innings.innings_number = 3 / 4`).

## What the formula does NOT account for

In rough order of "we considered it and chose not to":

1. **Match situation** — runs scored at 5/0 chasing 60 don't differ from runs scored at 5/0 chasing 200. We'd need ball-by-ball required-rate context for a "pressure" multiplier; not worth the complexity for a tournament app.
2. **Death-over weighting** — wickets in overs 6-7 aren't worth more than wickets in over 1. Real cricket commentary disagrees, but tipping the formula in either direction has odd second-order effects.
3. **Boundary in a chase to win the match** — a six off the last ball to win deserves more than a six in over 2 of innings 1. We don't model this.
4. **Slow scoring penalty for a stranded batter** — a 5(20) is worth +5 (just the runs), no penalty for the slow rate; we don't blame the batter for not getting the strike.
5. **Specialist roles** — a wicket-keeper who held 4 catches but didn't bat much gets credit; a captain who managed bowlers well doesn't. There's no captain bonus.
6. **Tournament-stage weighting** — a final-game POTM isn't worth more than a group-stage POTM. The formula is per-match, blind to stage.

If any of these become important later, they can be slotted in as additional terms — the function is the only place to edit.

## How to tune

If a real match produces an unfair pick:

1. Identify which threshold is at fault — look at the chip scores the admin sees in the form for the match in question.
2. Edit the literal in `computePerformances` in `match-awards.tsx`.
3. Update the table in this doc.
4. Ship a patch — no DB migration, no rerunning anything; the formula recomputes per page render.

Numbers that are most-likely to need adjustment as we see real tournament data:

- The 4+-wicket haul bonus (currently +30) — if a 4-for is *too* dominant.
- The strike-rate cutoffs — currently calibrated around T20 SRs, may be too generous for 7-over format where SRs run higher anyway.
- The winning-side bonus (+10) — may be too small if winning-side performances keep losing to comparable losing-side ones.

## Manual override flow

For admins (anyone with tournament-organizer or super-admin role on the tournament):

1. Open `/matches/[id]` after the match has been finalised.
2. Player of the Match card shows the auto-pick with the **Auto-pick** badge.
3. Click any of the top-3 suggestion chips to confirm that player, or use the dropdown for someone else.
4. The form auto-saves on change; no Save button.
5. "Use auto-pick" button clears `matches.player_of_match_id` and reverts the public display to the algorithm's choice.

The `setPlayerOfMatch` Server Action (`player-of-match/actions.ts`) verifies:
- Caller is a tournament admin.
- Match status is `completed`.
- Player is on one of the two XIs.

## File locations

| Concern | File |
|---|---|
| Formula + ranking | `src/app/matches/[matchId]/player-of-match/match-awards.tsx` (function `computePerformances`) |
| Admin override form | `src/app/matches/[matchId]/player-of-match/player-of-match-form.tsx` |
| Server Action (write) | `src/app/matches/[matchId]/player-of-match/actions.ts` |
| DB column | `matches.player_of_match_id` (UUID, nullable, FK → `players.id`) |
| This doc | `docs/POTM-FORMULA.md` |
