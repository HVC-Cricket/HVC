# HVC Scoring

Web app for live scoring + spectating a box-cricket tournament.

> **First read [HANDOFF.md](./HANDOFF.md)** — it has the full project context, stack rationale, schema map, free-tier analysis, decision log, and current phase status.

## Stack

- Next.js 16 (App Router, Turbopack default) + TypeScript + Tailwind v4 + shadcn/ui (base-nova)
- React 19.2, react-hook-form + zod 3, Sonner toasts
- Supabase: Postgres + Auth + Realtime + Row-Level Security
- Node 24 LTS via `.nvmrc`, pnpm 10

## Getting started

```bash
nvm use                            # picks up .nvmrc (Node 24 LTS)
pnpm install
cp .env.local.example .env.local   # fill in Supabase URL + anon key
pnpm dev
```

Open <http://localhost:3000>.

## Status

- ✅ **Phase 0** — Supabase project set up (Mumbai), schema applied, storage buckets created, env wired.
- ✅ **Phase 1** — Auth: `/signup`, `/login`, `/me`, Server Actions, role-aware nav. Super-admin bootstrapped.
- ✅ **Phase 2** — Tournaments / teams / players with full CRUD (create + list + detail + edit + delete) and roster management (`team_players`).
- ✅ **Phase 3** — Matches CRUD, playing XI per team, toss, per-tournament admin assignment (organizer/scorer). RLS-correct organizer permissions wired through every write path.
- ✅ **Phase 4** — Scoring engine.
  - ✅ **4a** Player category column (1/2/3) + UI badges.
  - ✅ **4b** Pure rules engine in `src/lib/scoring/` with the full HVC Season 6 ruleset (`HVC_RULES`). 19 Vitest tests passing. Run with `pnpm test`.
  - ✅ **4c** `tournaments.rules` JSONB defaults to `HVC_RULES` on create. Safe parser (`getRuleSet`) with HVC fallback.
  - ✅ **4d (part 1)** Ball-entry UI at `/matches/[matchId]/score`: start match, record balls (0–6, wide, no-ball, bye, wicket with type + player picker), single-ball undo, recent-balls strip, free-hit + special-over indicators. Server actions re-run the engine and hard-stop on rule violations.
  - ✅ **4d (part 2)** Innings break + innings 2 + match end. `state.ts` loads all innings + derives a phase. `startSecondInnings` flips sides and sets the chase target. `recordBall` auto-completes innings 2 when target chased; `finalizeMatchInternal` sets winner + win margin (by wickets / by runs / tie). New `InningsBreakPanel` and `MatchCompletePanel` UIs.
  - ✅ **4d (part 2.5)** Wide keypad (`Wide` / `+1` / `+2` / `+4`) and No-ball keypad (`NB` / `+1` / `+2` / `+4` / `+6`) so overthrows + boundaries off wides + bat runs off no-balls record correctly. 21 engine tests passing.
  - ✅ **4d (part 3a)** Super over flow: tied match → start innings 3 (team-2 bats first) → start innings 4 (chase) → finalize with super-over winner / super-over tie. Phase machine extended with `super_over_1/break/2/decided/tied`. Engine's existing 2-wicket / 1-over caps enforce themselves.
  - ✅ **4d (part 3b)** Multi-ball undo: "Undo last ball" + "Undo last 3" + "Undo this over" buttons; `voidLastN` server action voids N balls in one round-trip with a confirm() guard.
  - ✅ **4e** Defense-in-depth at the DB layer: 6 CHECK constraints on `balls` (run/extras/over ranges, wicket-type whitelist, wicket pair, legal_ball_seq consistency) plus triggers for free-hit dismissal and innings-complete blocking. Catches bypasses of the Server Action engine. Full Edge Function replay deferred (would require routing every recordBall through Deno + service-role).
- 🚧 **Phase 5** — Spectator view.
  - ✅ **Part 1** Live scorecard on `/matches/[id]`: score, RR, target/required-RR for chases, current batsmen + bowler stats, recent-balls strip, free-hit / special-over badges, match-end banner. Auto-refresh every 2.5s via cached HTTP polling (no realtime subscription, free-tier safe).
  - ✅ **Part 2** Standings on `/tournaments/[slug]` (P / W / L / T / NR / Pts / **NRR** — sorted by points → NRR → name; bowled-out innings use the full overs quota per ICC); full per-innings batting + bowling tables on completed matches with proper dismissal text and DNB detection.
  - ✅ **Part 2 (continued)** Public `/players/[playerId]` page with career totals + per-tournament breakdown via `v_player_tournament_stats`.
  - ✅ **Part 2 (OG)** Dynamic Open Graph images for matches (live score in the preview, refreshes every 60s) and tournaments. WhatsApp shares get a real preview card.
- 🚧 **Phase 6** — Polish.
  - ✅ PWA install (manifest + dynamic icons via `next/og`). App is installable on iOS / Android home screens.
  - ✅ Image upload — `LogoUploader` (browser → Supabase Storage with anon key + storage RLS). Wired into tournament / team / player edit forms; logos render on lists, grids, detail headers, and the match list.
  - ✅ shadcn AlertDialog for destructive actions (`ConfirmButton` wrapper + radix-based `alert-dialog.tsx`). All 6 confirm sites migrated.
  - ✅ Service worker + IndexedDB durable write queue. `public/sw.js` (network-first HTML, stale-while-revalidate assets, Supabase / Server Actions pass through) plus `src/lib/offline-queue.ts` (idb-backed durable queue). Each recordBall / voidLastBall / voidLastN is written to IDB before any network attempt — survives reloads, tab close, and offline gaps of any length. Drain pauses on network error and resumes on the `online` event (15s safety tick as backup). Two pills surface state: red "Offline · queuing" and yellow "Saving N…" in the Record-ball card.
  - ✅ Web push notifications (per-match opt-in). Tap 🔔 on /matches/[id] → browser PushManager subscribes → server stores via service-role client. Triggers: wicket, batter-50, batter-100, innings break, match end. Dispatched from `recordBall` via `next/server` `after()` (ball entry returns immediately). Requires VAPID keys + `SUPABASE_SERVICE_ROLE_KEY` env vars; see `.env.local.example`.
  - ✅ Manhattan + worm charts on /matches/[id]. Hand-rolled SVG, no charting lib. Manhattan = runs/over with wicket markers; worm = cumulative runs/delivery with target line for the chase. Auto-refreshes alongside the live scorecard.
  - ✅ **Optimistic UI on the scoring page (2026-05-11).** Score updates the instant you tap a run / wicket / extra / undo — server roundtrip is hidden. OptimisticBall + PendingUndo queues sit on top of the IDB write queue and reconcile when server state advances or regresses. Optimistic pills render at 60% opacity in the recent-balls strip; pending-undo balls disappear. Plus a wide / no-ball pill label fix (Wide +1 now reads `2wd` instead of `3wd`).
  - ✅ **Scorecard parity pass (2026-05-11).** Adds fall-of-wickets line, partnerships table (per innings), did-not-bat footer, bowler dots + maidens columns, current-partnership pill on the live panel, last-5-overs RR, and a yellow free-hit ring on ball pills.
  - ✅ **Auto Player-of-the-Match (2026-05-11).** Top scorer auto-shown as "Auto-pick" the moment the match completes; admins see the top 3 candidates as one-click chips and can override. Formula documented in [`docs/POTM-FORMULA.md`](docs/POTM-FORMULA.md).
  - ✅ **Scoring-page UX + correctness overhaul (2026-05-11 evening).** Driven by live testing. Merged the slot-tile + picker cards into one. Persisted innings-start picks (`initial_striker_id` etc; migration in `supabase/migrations/`). Engine replay in `state.ts` so striker rotation is correct. `advanceBowler` during replay so the engine's per-bowler counts track reality. HVC bowler rules enforced in `recordBall`: no consecutive overs, no mid-over changes, at most one bowler bowls 2 overs. Slot pickers grey out dismissed/other-batter options. Per-player stats line is optimistic. Wide/NB pill labels corrected. Overs counter labelled `1.0 / 7 ov`. Wicket form moved to a modal (bottom-sheet on phones, dialog on desktop). C&B hides the fielder picker.
  - ✅ **Per-over Category control + Cat 1/3 first-over rule (2026-05-12).** New `Category` dropdown on the scoreboard with three values: `Cat 1`, `Cat 2`, `Cat 3`. Default tracks the current over number (over 1 → Cat 1; over 2 → Cat 2; over 3+ → Cat 3) and re-applies on every over boundary while preserving scorer overrides mid-over. Cat 1 / Cat 3 restrict both striker and bowler pickers to that category and `submit()` aborts with a toast if the slots don't match. Cat 2 is open. The same Cat-1-must-face-Cat-1 enforcement was added at innings start: `startMatch` and `startSecondInnings` Server Actions now reject a Cat 1 striker paired with a non-Cat-1 bowler; the start panels block submit client-side before the round-trip. Super overs (innings 3/4) are exempt from the start-of-innings check; the dropdown's per-over logic still applies if used. The engine's `computeSpecialOverContext` now derives the special-over context from `striker.category` alone (drops the `over_number === cat1_over` / `cat3_over` gate), so the existing Cat 1/3 dismissal + stay-on-strike rules kick in whenever a Cat 1 / Cat 3 batter is on strike. `special_over` is cleared at the end-of-over swap inside `applyBall` so a dismissed special batter swapped to the non-striker slot is correctly blanked from the over 2 line-up. State loader's wicket-blanking is now state-based (`engine.dismissed`) with a `cat_special_strike = "stay"` exception, so a dismissed Cat 1 batter holds their slot for the rest of the over and is barred from re-batting later.
  - ✅ **Wicket-on-no-ball / wide / bye (2026-05-12).** Wicket modal grew a `Delivery` select alongside Type / Player out / Fielder — Legal (default), No-ball (+1 penalty), Wide (+1 penalty), Bye (+1). Selection flows through to `recordBall` so e.g. a run-out on the no-ball delivery records `extra_type='no_ball'` with both the penalty and the wicket in one ball.
  - ✅ **`balls_ball_in_over_range` allows 0 (2026-05-12).** A wide / no-ball bowled before the first legal delivery of an over is recorded with `ball_in_over = 0` per engine semantics; the old `1..6` constraint rejected it. Migration `supabase/migrations/20260512000000_balls_in_over_allow_zero.sql`; `db.sql` updated.
  - ✅ **Engine slot sync during replay (2026-05-12).** `applyBall` only rotates `striker_id` / `non_striker_id` — it doesn't accept new player IDs as input — so scorer-driven substitutions (e.g. picking a new non-striker after a run-out) were being overwritten by the engine's stale view on the next revalidation. `state.ts` (loader) and `actions.ts` (server replay + pre-validation) now call `setStriker` / `setNonStriker` before each `applyBall` so engine slots track the ball rows, plus the same sync at the pre-validation step in `recordBall`.
  - ✅ **Mobile header (2026-05-13).** Tournaments / Players nav links visible at every breakpoint; brand collapses to "HVC Scoring" on phones; user-name link becomes an initial-circle avatar.
  - ✅ **Wicket-on-extra pill label (2026-05-13).** Wicket on a wide / NB / bye now reads `1wd+W` / `1nb+W` / `1b+W` instead of just `W`.
  - ✅ **Refactor pass (2026-05-13).** Shared scoring helpers extracted to `@/lib/scoring/stats.ts` + `replay.ts`; supabase row-type aliases to `@/lib/supabase/row-types.ts`. Scoreboard split into `wicket-button.tsx` + `use-offline-queue.ts` + `record-ball-helpers.ts`. Pure code-quality work, no behavioural change.
  - ✅ **Default Category remap + Cat 1/3 repeat-dismissal rule (2026-05-13).** `defaultOverCategory` now maps over 1 → Cat 1, over 2 → Cat 3, over 3+ → Cat 2. Repeat dismissals of a Cat 1 / Cat 3 special batter inside their special over credit the bowler each time but only add to the team's innings total once. New `balls.counts_for_innings_total` column + `recompute_innings` filter; `recordBall` flags repeat-dismissal rows. Migration `supabase/migrations/20260513000000_balls_counts_for_innings_total.sql`.
  - ✅ **Wicket modal: Runs picker + byes-on-no-ball toggle (2026-05-13).** Five-button Runs row (0–4) inside the wicket modal records bat runs / wide extras / byes in one ball. When Delivery = No-ball, a "Runs are byes (not off the bat)" checkbox routes the N into `extras` instead of `runs_off_bat` — solves the NB + byes + run-out case where the striker shouldn't get credit.
  - ✅ **Single extras buttons with inline pickers + Overthrow (2026-05-13).** Replaced the Wide × 4 / NB × 5 / Bye × 4 / NB-Bye × 4 button-soup with a single row of 3–4 buttons (**Wide**, **No-ball**, **Bye**, **Overthrow**) that each expand into a 0–6 (or 1–7 for Overthrow) inline picker on tap. No-ball picker carries the same "Runs are byes" toggle. Overthrow covers the 5 / 7-run cases the main 0/1/2/3/4/6 row doesn't expose.
  - ✅ **Engine strike rotation on non-legal odd-run deliveries (2026-05-13).** `NB +1` / `NB +3` now swap strike. Wide + odd-extras swaps. Overthrow 5 swaps. Engine rotation gate moved from `isOddRun && isLegalBall` to a `rotationRuns` count that includes bat runs + byes + (extras − penalty) for wides/no-balls.
  - ✅ **Mobile slot tile layout (2026-05-13).** Striker + Non-striker share row 1 on phones; Bowler takes row 2 (col-span-2). Tablet+ keeps all three side-by-side.
  - ✅ **Recent-balls relocation (2026-05-13).** "This over" pills moved inside the Bowler slot tile via a new `footer` prop on `SlotPicker`. "Previous over" panel sits at the bottom of the page, only renders when there's a previous over. Top-of-screen RecentBalls card removed.
  - ✅ **Mobile-only hide of global site nav on score route (2026-05-13).** `SiteNavShell` (client wrapper) checks `usePathname()` and applies `hidden sm:block` when the route matches `/matches/[id]/score`. Frees the entire phone viewport for scoring; other routes / tablet / desktop unaffected.
  - ✅ **"Record ball" card header dropped (2026-05-13).** Ball-entry card has no header in idle state; only renders when an "Offline · queuing" or "Saving N…" pill needs to surface.
  - ✅ **Previous-over bowler disabled in the picker (2026-05-13).** At over boundaries (innings 1 + 2), the just-finished bowler is added to the bowler `SlotPicker`'s `disabledIds` so the scorer can't pick them at all — matches the server-side `validateBowlerRules` rule.
  - ✅ **Last-man-standing rule (2026-05-13).** New `RuleSet.last_man_standing` (HVC: true). When 6 of 7 batters are dismissed, the lone batter keeps batting until they're also out. Engine: strike rotation disabled, end-of-over swap skipped, wickets cap = `players_per_side`. UI: non-striker slot locked (dismissed batter stays in it as a dummy); orange **"Last man standing"** pill in the scoreboard header.
  - ✅ **Manual swap button (2026-05-13).** `⇄ Swap` icon in the Category row swaps striker / non-striker for the next ball. Disabled when slots empty or in last-man mode.
  - ✅ **`pnpm-workspace.yaml` fix (2026-05-13).** `onlyBuiltDependencies` malformed YAML string converted to a proper list; `supabase` postinstall now runs cleanly.
  - ✅ **Multi-scorer lock with permission-based takeover (2026-05-13).** Only one admin records balls per match. Second admin files a Request → current holder gets a sticky banner with Allow / Deny → lock transfers only on Allow. Falls back to free-claim if the holder's heartbeat goes idle for 2 min. Schema in `supabase/migrations/20260513000000_*` + `20260513010000_*`. Action layer enforces server-side too (every `recordBall` / `voidLast*` checks the lock).
  - ✅ **Commentary feed (auto, 2026-05-13).** Each ball maps to a one-line narrative (`"FOUR! Pavan finds the boundary off Sandy."`, `"WICKET! Ambrisha bowled by Virat."`). Grouped by innings, latest at top, auto-refreshes with the rest of the page. Manual per-ball notes deferred.
  - ✅ **Audit-log UI (2026-05-13).** Admin-gated `/matches/[id]/activity` page: every recorded + voided ball with the scorer's name, in reverse chronological order. Pure derived view over `balls.scored_by` / `voided_by`.
  - ✅ **Match-level audit (2026-05-13).** New `match_audit_events` table logs toss / XI / match start / innings transitions / match completion / POTM picks. Activity page merges these match-events with the ball-events in one chronological stream. `src/lib/match-audit.ts` helper logs from each action; reads + writes go through the service-role admin client (RLS denies all).
  - ✅ **Last-man-standing UX polish (2026-05-14).** Striker is now **auto-picked** as the lone live batter when last-man mode kicks in. The non-striker slot is **cleared** when it would otherwise point to that same live batter (no more "both ends show the same name"); any dismissed batter can be picked as the dummy via a relaxed non-striker picker.
  - ✅ **Wicket modal: Player out depends on type (2026-05-14).** Player out defaults to "Striker" for every dismissal type except **run-out**, which clears the field and forces an explicit pick (Save blocked with a toast if empty). Stops silent run-out mis-records of the wrong batter.
  - ✅ **Scoreboard slot-tile polish (2026-05-15).** Textual role labels removed; **bat icon** before each batter (cyan for striker, dim for non-striker — also colours the striker's name); **ball icon** before the bowler, with bowler stats inlined on the same row. `1×4 6×6` boundary count dropped from the batter stat line (still surfaces in the full scorecard).
  - ✅ **Scoring lock: faster takeover signalling (2026-05-18).** The multi-scorer permission flow was correct but slow + quiet — Scorer A could go up to 30 s before noticing Scorer B's request, and the only signal was a card quietly appearing above the (long) scoreboard. Split the single 30 s tick into a 5 s status poll + a 30 s heartbeat; added toasts on every poll-detected transition (request arrived, request approved, request denied, lock claimed from under me); added a short audible beep when a request lands for the holder; made the request banner sticky-positioned with `role="alert"` + `aria-live="polite"` so it follows the scorer down the page instead of scrolling out of view. Heartbeat path is now silent on failure so the poll owns all user-facing transitions (no duplicate toasts).
  - ✅ **Push notifications: pre-launch UX hardening (2026-05-18).** Three fixes before the tournament rollout. (a) Hide the Notify-me button when no service worker is registered — dev mode intentionally skips SW registration to avoid Turbopack conflicts, but the button was rendering anyway and `navigator.serviceWorker.ready` would hang forever on click. (b) iOS without PWA install — web push only delivers to apps added to the Home Screen on iOS; detect `iPad|iPhone|iPod` + non-standalone display mode and surface "Add to Home Screen first" guidance instead of subscribing into a dead end. (c) Send a one-off confirmation push immediately after subscribe so the user knows the pipeline works without waiting for a real wicket — new `notifyOne()` helper in `src/lib/push.ts`, fired via `after()` from `subscribePush`. Plus a disabled "🔕 Blocked" button state when `Notification.permission === 'denied'`.
  - ✅ **"Continue scoring" CTA for live + innings_break (2026-05-17).** Follow-up to the earlier sticky-bottom Start-scoring card. On a live / innings_break match the header was still rendering a primary `Score` pill inline with `Notify me` / `Activity` / `Edit`, which read like a selected tab right above the actual Live / Scorecard / Commentary / Info tab strip. Same fix as scheduled: lift the Score CTA out of the header into a full-width sticky card at the bottom; copy flips to **"Continue scoring"** for in-progress matches and stays **"Start scoring this match"** for scheduled. Notify / Activity / Edit stay in the header where they belong.
  - ✅ **Page-level refactor pass — formatters / helpers / home-page split (2026-05-17).** No behavioural changes; verified via tsc + vitest (21/21) + next build + eslint baseline. New `src/lib/format.ts` consolidates `formatScheduledAt` / `formatUpcomingTime` / `formatDateRange` / `formatMatchTime` / `formatEnumLabel` from 4 pages each. `src/lib/utils.ts` gains `getTeamInitials()` replacing 6 inline `short_name.slice(0,2).toUpperCase()` calls. `OrDivider` extracted to `src/app/(auth)/or-divider.tsx` (was duplicated in login + signup). Home page split: `src/app/page.tsx` shrank from 561 → 360 LOC after lifting `LiveMatchCard` + private `TeamLine` to `live-match-card.tsx` and view-model types to `home-types.ts`. 15 inline `.replace(/_/g, " ")` enum-label sites replaced with `formatEnumLabel`. Skipped per "≥2 callers" rule: `SectionSkeleton` (single file), `MS_PER_DAY` (single callsite), `displayTeamName` / `Stat` (single-use helpers).
  - ✅ **Repeated super overs no longer hit the innings cap (2026-05-17).** Starting the 2nd super over (innings 5) failed with `new row for relation "innings" violates check constraint "innings_innings_number_check"` — the schema capped `innings_number between 1 and 4`. The TS engine + `startSuperOverInnings` action already supported the full chain (3/4 → 5/6 → 7/8 …, re-super on tie per cricket rules); only the DB constraint was blocking. Migration `20260517020000_innings_number_uncap.sql` swaps the upper bound for `innings_number >= 1`. `finalizeMatchInternal` no longer hard-codes innings 3/4 as the super-over pair — it walks `innings >= 3` and picks the last pair as the decisive one (earlier pairs are tied by definition). Match-complete panel renders every super-over leg with a pair-index label when more than one pair was played.
  - ✅ **Scorers can set toss + pick XI (2026-05-17).** Scorers clicking "Pick XI" from the score page's pre-match checklist were being redirected to `/` — the XI route + `savePlayingXI` + `setToss` actions all called `requireOrganizer`, but the score page (gated `requireTournamentAdmin`) was already showing them those forms. Loosened all three guards to `requireTournamentAdmin` and matched the RLS: `mp_write` now uses `is_tournament_admin` (same as `innings` / `balls`), and `matches_write` is split into `matches_insert` / `matches_update` / `matches_delete` so scorers can persist toss + similar in-match state while INSERT / DELETE on `matches` stays organizer-only. Migration `20260517010000_scorer_can_set_toss_and_xi.sql`; db.sql updated.
  - ✅ **Playoff bracket auto-scheduling (2026-05-17).** For `round_robin_playoff_final` tournaments, the playoff chain is now wired up after each finalize. All group matches terminal → **Qualifier 1** (#1 vs #2 on points table; Pts → NRR). Q1 terminal → **Eliminator** (#3 vs #4). Eliminator terminal → **Qualifier 2** (Q1 loser vs Eliminator winner). Q2 terminal → **Final** (Q1 winner vs Q2 winner). Each transition fires inside `finalizeMatch` from a single `maybeAutoSchedulePlayoffs` helper, inherits overs/players/venue from a group match, is idempotent (won't re-create if the next-stage match already exists), and is best-effort wrapped — a failure here never blocks finalize. Standings (Pts + NRR) extracted to `src/lib/standings.ts` so the auto-scheduler and the points-table page share one computation.
  - ✅ **Tournament status stays Live through playoffs (2026-05-17).** `deriveTournamentStatus` now takes the match list + tournament format. For formats that include a Final stage (knockout / group_then_knockout / round_robin_playoff_final), the badge only flips to **Completed** once a final-stage match is terminal — so a tournament where group is done but the Final hasn't been scheduled yet stays **Live**. Other formats unchanged.
  - ✅ **Confirm before Swap (2026-05-17).** The ⇄ Swap button on the scoreboard now opens an `AlertDialog` ("X moves to non-striker; Y comes on strike. Cancel / Swap") so an accidental tap can't reorder the crease.
  - ✅ **Match complete: explicit finalize + Undo last ball (2026-05-17).** `recordBall` no longer auto-finalizes at the end of innings 2 / super-over innings 4; the match enters a "pending finalize" state and the `MatchCompletePanel` exposes "Finish match" alongside "Undo last ball" so a mis-tapped delivery can be rolled back before the result locks in. Match-completion push fan-out moved with completion (single dispatch from `finalizeMatch` on confirm, no fan-out on the optimistic last ball).
  - ✅ **Scoreboard chase line: balls remaining (2026-05-17).** Innings 2 footer now reads "Need *X* runs from *Y* balls · Target *T*" instead of just "Need X runs to win".
  - ✅ **Pick XI: select-all checkbox (2026-05-17).** Header row of the squad table has a master checkbox that toggles every player's `included` flag at once (with indeterminate state when partial). Saves clicking 12 individual rows for a full squad.
  - ✅ **Homepage innings FK disambiguation (2026-05-17).** Live/upcoming/recent match cards explicitly use `innings!innings_match_id_fkey(...)` so the embed isn't ambiguous now that `historical_match_*` tables also reference matches.
  - ✅ **Cricheroes MVP parity for historical seasons (2026-05-17).** Our HVC formula running against the empty `balls` table for S1–S6 produced a tie on team-bonus only (every Hoysala player at 80 for S6). New `historical_tournament_mvp` table (migration `20260517000000_*`, **prod only — dev didn't need it**) mirrors cricheroes' published MVP rows verbatim (decimal totals like 33.003) per tournament. `scripts/scrape_cricheroes.py` extended with `fetch_mvp_leaderboard()`; `scripts/import_cricheroes_mvp.ts` is a targeted importer that resolves UUIDs by slug + name without `--reset`-ing the rest of historical data. `tournament-mvp.tsx` falls back to this table when rows exist; new tournaments scored in our app keep using `@/lib/scoring/mvp`. View also drops category chips + drops Team-pts breakout for the cricheroes path.
  - ✅ **POTM card uses cricheroes MVP rank 1 for historical (2026-05-17).** The "Player of the Tournament" card on the completed-tournament hero used to count match-POM awards. For S1–S6 it now reads rank 1 from `historical_tournament_mvp` (Mady for S5, not Ashrith Kashyap who had more individual POM awards but a lower MVP score). New-format tournaments keep the POM-count behaviour.
  - ✅ **Stats tab works on historical seasons (2026-05-17).** `tournament-stats.tsx` previously read from `balls` only; S1–S6 saw "No balls bowled yet." A new historical fallback computes the same leaderboards from `historical_match_batting` / `historical_match_bowling` per-innings aggregates. Both paths use shared `BatAgg` / `BowlAgg` / `FieldAgg` helpers so output shape is identical.
  - ✅ **Stats tab: cricheroes-style BAT/BOWL/FIELD layout (2026-05-17).** Section pills (BAT / BOWL / FIELD) plus a Style dropdown picks one of 17 leaderboards: 7 batting (Top Runs · Highest Scores · Best SR · Best Avg · Most 4s · Most 6s · Most 50s), 7 bowling (Most Wickets · Best Avg · Best Econ · Best SR · BBI · Most Maidens · Most Dots), 3 fielding (Most Catches · Run Outs · Stumpings). FIELD pill hidden on cricheroes-imported seasons (commentary feed has no per-ball fielder credits). All-categories chip filter still works across the matrix. Most Centuries omitted by design (unreachable in 7 overs).
  - ✅ **Stats leaderboards paginate (2026-05-17).** Each table sends every qualifying row (up to 500) and the view paginates 10 per page with Prev/Next + "N–M of total" indicator. Switching style or category resets to page 1 by remounting via a `key` on `LeaderTable`.
  - ✅ **Stats player column: constrained width + wrap (2026-05-17).** Player column pinned at 140px on mobile (200px on sm+), and long names like "Pradhdhyumna Kashyap HP (Wk)" wrap to a second line via `break-words leading-tight` instead of pushing stat columns off-screen.
  - ✅ **Team squad: category chip next to each player (2026-05-17).** `/tournaments/[slug]/teams/[teamId]` now shows a coloured `C1` / `C2` / `C3` chip after every roster name (amber / muted / sky-blue — same palette as scoring + stats). Lets organisers verify category assignments at a glance before a tournament starts.
  - ✅ **Wicket modal: fielder mandatory for caught / run-out / stumped (2026-05-17).** Save now blocks with a toast ("Pick the fielder who caught it" / "…ran them out" / "Pick the wicket-keeper") when the fielder picker is empty for any of those three dismissal types. Same constraint enforced server-side via a Zod `.refine()` on `recordBallSchema` so an older or tampered client can't slip through. `caught_and_bowled` is unaffected (bowler is the implicit fielder). Previously the commentary feed would read "WICKET! X caught by ? off Y" and the wicket dropped from Most Catches / Run-outs / Stumpings.
  - ✅ **Match page: 'Start scoring' rendered as a CTA card (2026-05-17).** For scheduled matches, the primary call-to-action is now a full-width Link card below the header (Play icon + "Start scoring this match" + animated ChevronRight) instead of an inline pill next to Activity / Edit — testers were mistaking it for a selected tab and waiting for content to load. Live / innings_break matches keep the compact "Score" button in the header.
  - ✅ **Score page: inline toss + XI setup (2026-05-17).** Pre-scoring blockers (no toss / missing XIs) now render the actual `TossForm` + `XISection` inline on the score page instead of bouncing the scorer back to the match page. `TossForm` dropped its Save button — picking both selects auto-commits, collapses to a single-line summary + Edit toggle. Pick XI calls `router.back()` on save so the scorer returns to wherever they came from.
  - ✅ **Pick XI: slimmed to In / Player / Sub (2026-05-17).** Dropped the Order, Captain, and WK columns. Captain is a roster role on the team squad page; wicket-keeper rotates per delivery and is picked on the scoreboard; batting order is live state (striker / non-striker chosen each ball). Header copy updated to point at where each one actually lives.
  - ✅ **Team squad: category chip per player (2026-05-17).** `/tournaments/[slug]/teams/[teamId]` shows a coloured C1 / C2 / C3 chip after every roster name (amber / muted / sky — same palette scoring + stats use). Organisers can verify category assignments before a tournament starts.
  - ✅ **Points table: NRR finally renders + Team column narrower (2026-05-17).** Fixed an embed-ambiguity bug where `innings → matches` would silently 400 (`PGRST201`) because `matches` has two FKs back to `innings` (parent FK + live-innings pointer) — Standings was rendering `—` for every team's NRR. Pinned the embed to `matches!innings_match_id_fkey` in `points-table-section.tsx`, `lib/standings.ts` (also used by the playoff auto-scheduler's NRR tie-break), and the POTM card's tie-break chain in `tournament-champion.tsx`. Team column on the standings table also pinned to 130/180px so PTS + NRR have breathing room on mobile.
  - ✅ **Match page: sticky-bottom Start scoring CTA (2026-05-17).** For scheduled matches the primary CTA is now pinned to the viewport bottom (backdrop-blurred bar, `max-w-3xl` inner container, `env(safe-area-inset-bottom)` for iOS) instead of inline below the header. Scorers no longer have to scroll back up after reading Details / Toss / Squad cards to actually start the match. Live / innings_break keep the compact "Score" button in the header.
  - ✅ **Innings-1 pending-finalize gate (2026-05-17).** Mirrors the match-complete escape hatch at innings break. `recordBall` no longer stamps `innings.ended_at` on the final ball of innings 1 — it flags `is_complete=true` and surfaces a new `InningsFinishPanel` (phase `innings_1_pending_finish`) with **Finish innings** + **Undo last ball**. `finalizeInnings` stamps `ended_at` on confirm; `voidLastBall` clears both flags so the scoreboard reopens cleanly on undo. Innings 2 / super-over unchanged.
  - ✅ **Cat 1/3 auto-pick on category change (2026-05-17).** When the over-Category dropdown flips to Cat 1 or Cat 3, the striker + bowler slot tiles auto-fill with the first eligible player of that category (non-dismissed XI member for striker, non-previous-over bowler for bowler). Cat 2 is "any" → no-op. Saves the taps every over boundary when the default category restricts the picker.
  - ⏭ **Tournament-end awards screen** (top run scorer / top wicket taker / best figures / Player of the Tournament — all derivable from existing data, no schema change). Wagon wheel (needs scoring-page tap-zone capture).
- ✅ **Phase 7 (2026-05-09)** — Access-control hardening for players.
  - Player-registry writes restricted to super-admins + tournament organizers (was: any signed-in user). Scorers can no longer create/edit players.
  - `players.linked_user_id` (already in schema) now has a partial unique index — one auth user maps to at most one player record. Optional email field on the player create/edit forms looks up the auth user via a new SECURITY DEFINER helper and links the records, so admins/scorers who also play have one cricket-history record across both roles.
  - `/me` shows the user's linked player record. Player detail page surfaces "Linked to: email" for signed-in users.

See HANDOFF.md §8 / §9 for the full breakdown, and §9b for the Supabase CLI migration workflow.

## Routes built so far

| Route | Auth | What it does |
|---|---|---|
| `/` | public | placeholder landing |
| `/signup` `/login` | public | auth |
| `/me` | signed-in | profile read (verifies auth + RLS) |
| `/tournaments` | public | list |
| `/tournaments/new` | super-admin | create |
| `/tournaments/[slug]` | public | detail with matches + teams |
| `/tournaments/[slug]/edit` | organizer | update; delete is super-admin only |
| `/tournaments/[slug]/admins` | organizer | add/remove organizers + scorers by email |
| `/tournaments/[slug]/matches/new` | organizer | create match |
| `/tournaments/[slug]/teams/new` | organizer | create team |
| `/tournaments/[slug]/teams/[teamId]` | public | team + roster |
| `/tournaments/[slug]/teams/[teamId]/edit` | organizer | update / delete |
| `/matches/[matchId]` | public | match detail (teams, schedule, toss, playing XI) |
| `/matches/[matchId]/edit` | organizer | update / delete |
| `/matches/[matchId]/xi/[teamId]` | organizer | pick playing XI (captain, keeper, batting order) |
| `/matches/[matchId]/score` | organizer / scorer | live ball-entry scoreboard (gated on toss + both XIs) |
| `/players` | public | global player registry |
| `/players/new` | signed-in admin | create |
| `/players/[playerId]` | public | career stats (R / W / SR / Econ + per-tournament breakdown) |
| `/players/[playerId]/edit` | signed-in admin | update; delete is super-admin only |

"Organizer" includes super-admin. The organizer/scorer permission model is wired end-to-end through `requireOrganizer` / `requireTournamentAdmin` helpers in `src/lib/auth.ts` and the matching SQL helpers in `db.sql`. Add organizers/scorers via `/tournaments/[slug]/admins`.

## Common dev commands

```bash
pnpm dev                          # localhost:3000
pnpm exec tsc --noEmit            # typecheck

# Type generation — pick the env you just migrated:
DEV_PROJECT_REF=clqdimzthzcpurtwhtej pnpm gen:types:dev    # day-to-day after dev migration
pnpm gen:types:prod                              # only after prod migration

# Run admin SQL against the LINKED DB — check link first!
pnpm exec supabase db query --linked "select count(*) from tournaments;"
pnpm exec supabase db query --linked --file path/to/script.sql

# Seed dev with the 6 historical CricHeroes seasons (data/cricheroes/csv/):
# Safety guard refuses to run against prod.
pnpm run seed:cricheroes              # insert
pnpm run seed:cricheroes -- --reset   # clear target tables first
```

**Two-environment topology** (as of 2026-05-16): `cxysyglwooqmzcfvtmyl` = **prod** (`main` branch, seeded with CricHeroes Seasons 1–6); `clqdimzthzcpurtwhtej` = **dev** (`dev` branch, empty). See HANDOFF §15 for the provisioning record + migration-propagation workflow (dev-first → main merge → manual prod apply).

**Switching local `.env.local` between envs.** Two checked-out-but-gitignored template files hold both sets of creds:

```bash
cp .env.dev  .env.local      # work against dev
cp .env.prod .env.local      # work against prod (only when actually testing prod)
pnpm exec supabase link --project-ref <ref>   # re-link CLI to match
```

Default day-to-day: `.env.dev` → `.env.local`. **`supabase link` state is per-checkout** (`supabase/.temp/linked-project.json`, git-ignored) — always confirm what you're linked to before `db push`.

If `pnpm dev` errors with "Another next dev server is already running":
```bash
rm -f .next/dev/lock && pnpm dev
```

## Bootstrap the first super admin (one-time)

After your first signup, run via the Supabase CLI (already linked):

```bash
pnpm exec supabase db query --linked "update profiles set is_super_admin = true where id = (select id from auth.users where email = 'your-email@example.com');"
```

Refresh `/me` — should show `Super admin: yes`.

## Layout (snapshot)

```
src/
  app/
    (auth)/                  # signup / login / signOut Server Action
    me/                      # protected profile page
    tournaments/             # list + create + detail + edit
      [slug]/admins/         # organizer + scorer assignment
      [slug]/matches/        # match create
      [slug]/teams/          # team CRUD + roster
    matches/[matchId]/       # public detail + edit + toss + pick XI
    players/                 # list + create + edit
    layout.tsx               # mounts SiteNav + Toaster
  components/
    site-nav.tsx             # server component, getUser() → email + Sign out
    ui/                      # shadcn: button, card, input, label, sonner, form
  lib/
    auth.ts                  # requireUser / requireSuperAdmin / requireOrganizer / requireTournamentAdmin / getSessionContext
    slug.ts                  # slugify()
    supabase/                # client / server / middleware / database.types stub
  proxy.ts                   # Next 16 proxy convention
db.sql                       # schema (matches live DB)
HANDOFF.md                   # full handoff, read first
AGENTS.md / CLAUDE.md        # Next 16 reminder for AI assistants
.nvmrc                       # Node 24
```

## Next 16 quirks worth knowing

- `middleware.ts` is renamed to `proxy.ts`; function name is `proxy`. Node.js runtime only, no edge.
- `cookies()`, `headers()`, `params`, `searchParams` are async-only — always `await`.
- Turbopack is the default for dev and build (no `--turbopack` flag).
- A lockfile in `.next/dev/lock` prevents concurrent `pnpm dev` instances.
