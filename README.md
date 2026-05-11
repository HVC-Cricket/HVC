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
  - ⏭ Wagon wheel (needs scoring-page tap-zone capture), commentary feed.
- ✅ **Phase 7 (2026-05-09)** — Access-control hardening for players.
  - Player-registry writes restricted to super-admins + tournament organizers (was: any signed-in user). Scorers can no longer create/edit players.
  - `players.linked_user_id` (already in schema) now has a partial unique index — one auth user maps to at most one player record. Optional email field on the player create/edit forms looks up the auth user via a new SECURITY DEFINER helper and links the records, so admins/scorers who also play have one cricket-history record across both roles.
  - `/me` shows the user's linked player record. Player detail page surfaces "Linked to: email" for signed-in users.

See HANDOFF.md §8 / §9 for the full breakdown.

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
