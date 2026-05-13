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
  - ✅ **Multi-scorer lock with permission-based takeover (2026-05-13).** Only one admin records balls per match. Second admin files a Request → current holder gets a sticky banner with Allow / Deny → lock transfers only on Allow. Falls back to free-claim if the holder's heartbeat goes idle for 2 min. Schema in `supabase/migrations/20260513000000_*` + `20260513010000_*`. Action layer enforces server-side too (every `recordBall` / `voidLast*` checks the lock).
  - ✅ **Commentary feed (auto, 2026-05-13).** Each ball maps to a one-line narrative (`"FOUR! Pavan finds the boundary off Sandy."`, `"WICKET! Ambrisha bowled by Virat."`). Grouped by innings, latest at top, auto-refreshes with the rest of the page. Manual per-ball notes deferred.
  - ⏭ **Tournament-end awards screen** (top run scorer / top wicket taker / best figures / Player of the Tournament — all derivable from existing data, no schema change). Wagon wheel (needs scoring-page tap-zone capture), audit log UI.
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
pnpm gen:types                    # regenerate src/lib/supabase/database.types.ts (needs supabase login + link)

# Run admin SQL against the live DB:
pnpm exec supabase db query --linked "select count(*) from tournaments;"
pnpm exec supabase db query --linked --file path/to/script.sql
```

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
