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
- 🚧 **Phase 4** — In progress.
  - ✅ **4a** Player category column (1/2/3) + UI badges.
  - ✅ **4b** Pure rules engine in `src/lib/scoring/` with the full HVC Season 6 ruleset (`HVC_RULES`). 19 Vitest tests passing. Run with `pnpm test`.
  - ✅ **4c** `tournaments.rules` JSONB defaults to `HVC_RULES` on create. Safe parser (`getRuleSet`) with HVC fallback.
  - ✅ **4d (part 1)** Ball-entry UI at `/matches/[matchId]/score`: start match, record balls (0–6, wide, no-ball, bye, wicket with type + player picker), single-ball undo, recent-balls strip, free-hit + special-over indicators. Server actions re-run the engine and hard-stop on rule violations.
  - ✅ **4d (part 2)** Innings break + innings 2 + match end. `state.ts` loads all innings + derives a phase. `startSecondInnings` flips sides and sets the chase target. `recordBall` auto-completes innings 2 when target chased; `finalizeMatchInternal` sets winner + win margin (by wickets / by runs / tie). New `InningsBreakPanel` and `MatchCompletePanel` UIs.
  - ✅ **4d (part 2.5)** Wide keypad (`Wide` / `+1` / `+2` / `+4`) and No-ball keypad (`NB` / `+1` / `+2` / `+4` / `+6`) so overthrows + boundaries off wides + bat runs off no-balls record correctly. 21 engine tests passing.
  - ✅ **4d (part 3a)** Super over flow: tied match → start innings 3 (team-2 bats first) → start innings 4 (chase) → finalize with super-over winner / super-over tie. Phase machine extended with `super_over_1/break/2/decided/tied`. Engine's existing 2-wicket / 1-over caps enforce themselves.
  - ⏭ **4d (part 3b)** Multi-ball undo stack (single-ball undo already works).
  - ⏭ **4e** Supabase Edge Function for defense-in-depth server-side validation.
- 🚧 **Phase 5** — Spectator view.
  - ✅ **Part 1** Live scorecard on `/matches/[id]`: score, RR, target/required-RR for chases, current batsmen + bowler stats, recent-balls strip, free-hit / special-over badges, match-end banner. Auto-refresh every 2.5s via cached HTTP polling (no realtime subscription, free-tier safe).
  - ✅ **Part 2** Standings on `/tournaments/[slug]` (P / W / L / T / NR / Pts via `v_points_table`); full per-innings batting + bowling tables on completed matches with proper dismissal text and DNB detection.
  - ✅ **Part 2 (continued)** Public `/players/[playerId]` page with career totals + per-tournament breakdown via `v_player_tournament_stats`.
  - ⏭ **Part 2 (rest)** OG share images.
- ⏭ **Phase 5** — Spectator view (cached HTTP polling, NOT realtime).
- ⏭ **Phase 6** — PWA, charts, push notifications, image uploads.

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
