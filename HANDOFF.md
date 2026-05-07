# HVC Scoring — Project Handoff

> **Purpose of this doc:** Bring a new collaborator (human or AI) fully up to speed on the HVC Scoring project — what it is, why we're building it, every decision made so far, the schema we've designed, what's done, and what's next. Upload this file at the start of a fresh Claude Code session and the assistant will have full context.

---

## 1. TL;DR

We are building **HVC Scoring**, a web app for live scoring and spectating a **box cricket tournament** with custom rules. Multiple admins enter ball-by-ball data; 50–60+ spectators (possibly more) follow scores live in their browsers.

**Status as of 2026-05-07:** **Phase 0, 1, 2, and 3 are done. Phase 4 is in progress: 4a (player category) + 4b (rules engine + Vitest tests) done; 4c (wire HVC_RULES into tournaments.rules), 4d (ball-entry UI), and 4e (Edge Function validation) remaining.** Supabase project provisioned in Mumbai, schema applied, Next.js 16 app scaffolded with auth + tournaments + teams + players + roster + matches + playing XI + toss + per-tournament admin assignment + the HVC scoring engine (pure functions, 19 tests passing). RLS-correct organizer/scorer permission model wired end-to-end. One super admin (`pavan.gautham17@gmail.com`) is bootstrapped.

**Project directory:** `~/Desktop/projects/hvc-scoring/` (Pavan's machine; was `/home/sudharshan/projects/own/hvc-scoring/` for the prior author).
**Files in repo today:**
- `db.sql` — full schema; live DB matches this. The `prevent_self_promote()` trigger has been patched to allow direct-DB callers (Management API / dashboard SQL editor / service_role) to bootstrap the first super admin.
- `HANDOFF.md` — this file.
- `README.md` — short setup pointers + per-phase summary of what's built.
- `AGENTS.md` / `CLAUDE.md` — Next 16 reminder to read `node_modules/next/dist/docs/` before writing code.
- `package.json`, `.env.local.example`, `.nvmrc` (pinned to Node 24), `components.json`, etc.
- `src/` — see §6.5 below for the layout.

**Live infra:**
- **Supabase project ref:** `cxysyglwooqmzcfvtmyl` (region: South Asia — Mumbai). Owner: `hvc.cricket@gmail.com`'s org.
- **Project URL:** `https://cxysyglwooqmzcfvtmyl.supabase.co`
- **CLI:** `pnpm exec supabase` is linked to the project. `pnpm exec supabase db query --linked "<sql>"` runs SQL via the Management API; no DB password needed.

---

## 2. Project context

- **Domain:** Box cricket (indoor/netted, smaller ground, typically 6–8 a side). Rules are *mostly* like standard cricket but with custom variants the user will share later.
- **Format:** Tournament-style — multiple matches across teams, may be league / knockout / group-then-knockout.
- **Users:**
  - **Super admin** — manages organizers, full access.
  - **Organizers** — admin a specific tournament: create matches, manage teams/players, add scorers.
  - **Scorers** — enter ball-by-ball data for matches they're assigned to.
  - **Spectators** — anonymous public viewers, no login. Watch live scoreboards.
- **Scale:** 50–60+ concurrent spectators per match, possibly more for finals. ~5–20 admin users.
- **Previously used:** [CricHeroes](https://cricheroes.com/) for scoring. **Decision: not migrating that historical data** (see §7).

---

## 3. Tech stack (locked in)

### Frontend
- **Next.js 15 (App Router) + TypeScript** — handles both interactive admin scoring UI and SSR'd spectator pages in one codebase. Type-safety important for scoring rule edge cases.
- **Tailwind CSS + shadcn/ui** — fast to build, accessible, easy to theme.
- **Lightweight state**: Zustand or React Context — no Redux.
- **PWA support**: `next-pwa` so admins can install on phone and score with patchy Wi-Fi.

### Backend / data / auth / realtime
- **Supabase** (one platform, four services):
  - **Postgres** — relational fits cricket (tournaments → matches → innings → balls).
  - **Auth** — email/password + optional Google OAuth.
  - **Realtime** — WebSocket subscriptions for live updates.
  - **Row Level Security (RLS)** — authorization enforced at DB level, not just app code. Big security win.
- Custom **scoring rules engine** as a separate TypeScript module (pure functions). Rules stored as JSONB per tournament so box-cricket variants don't require code changes. Same module runs on the client (instant feedback) and is validated server-side via Supabase Edge Functions.

### Hosting
- **Vercel** — Next.js frontend (free tier sufficient).
- **Supabase Cloud** — DB + auth + realtime (free tier sufficient *with caveat*; see §4).
- (Optional) Cloudflare in front for caching spectator pages and DDoS protection.

### Dev tooling
- pnpm
- Drizzle ORM **or** Supabase auto-generated types — pick one when scaffolding.
- Vitest for rules-engine unit tests.
- Playwright for end-to-end scoring flow.
- GitHub Actions for CI.

### Why this stack (rationale recap)
- **One platform** for auth + DB + realtime + storage with security via RLS, instead of stitching Express + Socket.io + JWT + Postgres yourself.
- **Postgres over Firestore** — cricket data is heavily relational; SQL keeps stats sane.
- **TypeScript end-to-end** with generated DB types.
- **Main tradeoff:** Supabase vendor lock-in. Mitigated because Supabase is just Postgres + open-source services — self-hostable later.

---

## 4. Supabase free tier analysis

For our usage, free tier covers everything except potentially **concurrent realtime connections**.

| Resource | Free tier limit | Our expected usage | Verdict |
|---|---|---|---|
| Database size | 500 MB | ~50–100 MB per full tournament | Plenty |
| Auth users (MAU) | 50,000 | Only admins log in (~5–20) | Plenty |
| API bandwidth | 5 GB/month | Tiny JSON updates | Plenty |
| Edge Function invocations | 500K/month | Only ball-validation | Plenty |
| **Realtime concurrent connections** | **200** | **50–60 expected, "may be more"** | **Watch this** |
| Realtime messages | 2M/month | ~7K per match | Plenty |

### The one ceiling — 200 concurrent WebSocket connections

If a finals match draws 200+ viewers, new spectators get disconnected on free tier.

**Mitigation (no upgrade needed):** Spectator pages do **not** subscribe via Realtime. Instead they fetch a cached HTTP endpoint that revalidates every 2–3 seconds. Only the admin scoring screen uses Realtime. Pattern handles thousands of spectators on free tier.

### Other free-tier gotcha
Projects **pause after 1 week of inactivity** on free tier (~30s cold start on next request). Mitigation: cron-ping every few days, or upgrade.

### When to upgrade
$25/month Pro tier removes pausing, lifts Realtime to 500 concurrent, daily backups. Defer until tournament is live and you want zero-friction match days.

---

## 5. Features

### Essential (MVP)

**Auth & roles**
- Email/password (or Google) login.
- Roles: super-admin / organizer / scorer / spectator (no login).
- Super-admin can add/remove/demote organizers.
- Organizer can manage scorers within their tournament.

**Match setup**
- Create tournament: format, default overs, default players-per-side, custom rules JSON.
- Create match: teams, scheduled date, venue, format overrides.
- Toss + decision (bat/bowl).
- Edit/delete match (organizer only).

**Live scoring (admin)**
- Ball-by-ball entry: runs (0–6), wide, no-ball, bye, leg-bye, wicket (type + fielder).
- Strike rotation, over completion auto-handled.
- **Undo last ball** (critical — scorers will mis-tap; we void, never delete).
- Change batsman / bowler, retired hurt, new batsman on wicket.
- Innings break, end of match.
- Free-hit and powerplay flags per ball.

**Spectator view (live)**
- Current score, overs, run rate, required rate (chase).
- Batsmen on crease + their stats (R, B, 4s, 6s, SR).
- Current bowler stats (O, M, R, W, econ).
- Recent overs / last 6 balls.
- Auto-updates without refresh (cached HTTP polling).

**Match list**
- Live, upcoming, completed.
- Full scorecard for completed matches.

### Good-to-have add-ons (build incrementally)

- Commentary feed (auto + manual per ball)
- Required run rate / projected score
- Partnership tracker + fall-of-wickets
- Manhattan / worm chart
- Wagon wheel (where each ball was hit) — admin taps a circle
- Pitch map
- Shareable match link + Open Graph image (WhatsApp shares look good)
- Push notifications (wicket / 50 / 100 / match end)
- PWA / offline scoring with sync
- Player career stats across tournaments
- Tournament series mode + points table
- **Multi-scorer with conflict prevention** — only one "primary scorer" at a time, others spectate scoring screen with takeover button (prevents two admins double-entering balls)
- Audit log of who scored what (already in schema)

---

## 6. Database schema

Full schema lives in **`db.sql`** at the repo root. It is **complete and ready to run** in Supabase.

### Schema map

```
auth.users (Supabase managed)
   └── profiles                    — display name, avatar, is_super_admin
        └── tournament_admins      — per-tournament permissions

tournaments                        — top container, has rules JSONB
   ├── teams                       — competing teams (tournament-scoped)
   │    └── team_players           — roster (player + role)
   ├── players                     — global player registry
   └── matches                     — individual games
        ├── match_players          — playing XI per team per match
        └── innings                — 1 or 2 per match (3-4 for super over)
             └── balls             — ball-by-ball, the core table

audit_log                          — append-only history
```

### Tables (11 total)

| Table | Purpose |
|---|---|
| `profiles` | Extends `auth.users` with display name, avatar, `is_super_admin` flag. Auto-created on signup via trigger. |
| `tournaments` | Top-level container. Holds custom rules in `rules` JSONB. Has `default_overs_per_innings` + `default_players_per_side` (default 6 for box cricket). |
| `tournament_admins` | Junction: which user has what role (`organizer` or `scorer`) on which tournament. |
| `teams` | Tournament-scoped (each tournament gets its own teams). Has name, short_name, logo, color. |
| `players` | **Global** registry — same person across tournaments → cumulative stats. |
| `team_players` | Roster — player + jersey + role (captain/vc/wk/player). |
| `matches` | Per-tournament. Stage (group/quarter/semi/final), teams, schedule, venue, toss, status, result, winner. `current_innings_id` for fast live lookup. |
| `match_players` | Playing XI per team per match. Includes `is_captain`, `is_keeper`, `is_substitute`, `batting_order`. |
| `innings` | 1 or 2 per match (3–4 for super over). Cached aggregates: `total_runs`, `total_wickets`, `total_legal_balls`, extras breakdown. |
| `balls` | **The core scoring table.** Every delivery. Includes `is_voided` (we void instead of delete for undo + audit). Has `custom_data` JSONB for box-cricket-specific events. |
| `audit_log` | Append-only history of meaningful actions (organizer changes, match created, etc.). |

### Key design decisions

- **`is_voided` instead of DELETE** — undo must be auditable, never lose data. Rules engine ignores voided balls.
- **`rules` and `custom_data` as JSONB** — box cricket has rule variants we don't know yet. Schema stays stable; rules engine reads JSON.
- **Cached aggregates on `innings`** — spectator scoreboard reads one row, not 600 balls. Trigger recomputes them on every ball insert/update/void (full recompute is cheap — innings rarely > 600 balls).
- **`players` global, `teams` per-tournament** — same person plays across tournaments → cumulative career stats. Teams typically rebrand each tournament.
- **`text` + `check` constraints, not enums** — Postgres enums are painful to migrate; check constraints are equally safe and rule-engine-friendly.
- **No `tournament_id` denormalized to `balls`** — derivable through `innings → match → tournament`. Don't denormalize prematurely.

### Triggers (in `db.sql`)
- `handle_new_user()` — auto-create `profiles` row when `auth.users` gets new user.
- `set_updated_at()` — maintain `updated_at` on profiles, tournaments, matches.
- `prevent_self_promote()` — only super admins can change `is_super_admin`.
- `recompute_innings()` + `trg_balls_recompute_innings()` — recompute innings aggregates on any ball change.

### Views (6 total — derived stats, no redundant storage)
- `v_innings_batting` — per innings, per batter: runs, balls faced, 4s, 6s.
- `v_innings_bowling` — per innings, per bowler: legal balls, runs conceded, wickets, wides, no-balls.
- `v_fall_of_wickets` — wicket fall sequence with score at fall.
- `v_match_summary` — match list with team scores joined.
- `v_points_table` — standings per tournament: P/W/L/T/NR + points (2 per W, 1 per T/NR). NRR not yet computed (TODO).
- `v_player_tournament_stats` — runs, wickets, balls faced, etc. per player per tournament.

### RLS strategy

All 11 tables have RLS enabled. Helper functions (SECURITY DEFINER to avoid recursion) are defined in `db.sql`:
- `is_super_admin(user_id)`
- `is_tournament_admin(tournament_id, user_id)` — organizer OR scorer
- `is_tournament_organizer(tournament_id, user_id)` — organizer only
- `tournament_id_for_match(match_id)`, `tournament_id_for_innings(innings_id)` — lookup helpers

**Policy summary:**

| Table | Read | Write |
|---|---|---|
| profiles | All | Update own; only super-admin can change `is_super_admin` |
| tournaments | All (public spectators) | Insert: super-admin. Update: organizer of that tournament. Delete: super-admin |
| tournament_admins | All | Super-admin manages all; organizers can manage `scorer` rows in their tournament |
| teams, team_players | All | Organizer of that tournament |
| players | All | Insert/update: any authenticated admin. Delete: super-admin only |
| matches, match_players | All | Organizer of that tournament |
| innings, balls | All (non-voided) | Any tournament admin (organizer or scorer) of that tournament |
| audit_log | Super-admin + tournament organizers | Triggers / service role only |

### Realtime
`balls`, `innings`, `matches` are added to the `supabase_realtime` publication. Admin scoring screen subscribes; spectator pages should use cached HTTP (see §4).

---

## 7. Decisions made (decision log)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-06 | Use Next.js + Supabase, free tier | Simplicity, security via RLS, single-platform, no ops burden |
| 2026-05-06 | Spectator pages use cached HTTP, not Realtime | Stay under free-tier 200 concurrent connections |
| 2026-05-06 | Custom rules as JSONB, applied via pure-function rules engine | Box-cricket rule variants without schema changes |
| 2026-05-06 | **Drop CricHeroes data migration** | They have no self-serve export; scraping risks ToS; not worth the effort. Start fresh from next match |
| 2026-05-06 | `is_voided` instead of DELETE on balls | Auditable undo, no data loss |
| 2026-05-06 | Cached aggregates on `innings` table | Single-row reads for spectator scoreboard |
| 2026-05-06 | `players` global, `teams` per-tournament | Cross-tournament career stats |
| 2026-05-06 | Postgres `text + check` instead of enums | Easier migration than enums |
| 2026-05-06 | Schema written to `db.sql`, ready to run | Single-file deploy to Supabase |
| 2026-05-07 | Switched scaffold target from Next.js 15 to **Next.js 16.2.5** | `create-next-app@latest` ships 16; sticking with the latest stable saves an upgrade later. Required Node ≥20.9. |
| 2026-05-07 | Pinned **Node 24 (active LTS)** via `.nvmrc` | Tailwind v4's `@tailwindcss/oxide` requires Node ≥20; Node 18 silently breaks pnpm's optional-binary install. 24 is the cleanest forward-compatible choice. |
| 2026-05-07 | **shadcn `base-nova` preset** (default since shadcn 4.x) used for components | New default; built on `@base-ui/react` instead of radix-ui. The `form` component still depends on `@radix-ui/react-slot`, which is the only radix dep we ship. |
| 2026-05-07 | Pinned **zod 3.25.76** (downgraded from zod 4) | `@hookform/resolvers@5.2.2` types lag zod 4.4.x. Re-evaluate when resolvers ships full zod-4 support. |
| 2026-05-07 | **Form library:** react-hook-form + zod + shadcn `Form` (with `@hookform/resolvers/zod`) | Standard combo, works well with Server Actions. |
| 2026-05-07 | **Open signup**, super-admin manually promotes | Simplest MVP; matches schema's `handle_new_user()` trigger. Decision recorded in memory. |
| 2026-05-07 | Patched `prevent_self_promote()` to allow `auth.uid() is null` | The original form blocked the Management API / dashboard SQL editor / service_role, making the very first super admin un-creatable. Trusted callers (already RLS-bypassed) now pass through. |
| 2026-05-07 | **Native `confirm()` for destructive actions** in MVP | One click, browser dialog. Swap to a styled `AlertDialog` later. |
| 2026-05-07 | **Defer admin assignment (organizer/scorer) to Phase 3** | Phase 2 super admin acts as universal organizer (RLS helpers already allow super admin everywhere). Wired in Phase 3. |
| 2026-05-07 | Added `lookup_user_id_by_email(text)` SECURITY DEFINER function | Lets organizers resolve emails to user_ids when adding scorers, without giving the client service-role access. Authenticated only; null result on miss. |
| 2026-05-07 | **`requireOrganizer(tournamentId)` / `requireTournamentAdmin(tournamentId)`** helpers in `src/lib/auth.ts` | Mirror of the SQL helpers; UX gate so non-organizers don't even see the gated page (better than relying solely on RLS to reject). |
| 2026-05-07 | **Drop, don't optionalize** — when a field isn't core to the flow, remove it from form + display + DB | Pavan's preference (saved to memory). Removed `team_players.jersey_number` and `teams.color` entirely. DB columns dropped on live + `db.sql`. |
| 2026-05-07 | Added `players.category` smallint (1/2/3) | Required for HVC bowling-order rules: Cat 1 vs Cat 1 in over 1, Cat 3 vs Cat 3 in over 2, Cat 2 elsewhere. Nullable so non-HVC tournaments don't have to set it. |
| 2026-05-07 | **Rules engine is pure functions** in `src/lib/scoring/` (no I/O) | Same module can run on the client (instant feedback) AND in a Supabase Edge Function (server-side validation), with `balls` rows replayable into any historical state. Vitest covers the engine in isolation. |
| 2026-05-07 | HVC ruleset baked into `HVC_RULES` constant; `tournaments.rules` JSONB will store overrides | Per-tournament rule mutations don't need schema changes; engine reads the `RuleSet` shape directly. |

---

## 8. What's done

### Planning / decisions (carried over)
- [x] Tech stack chosen and rationalized
- [x] Free-tier analysis and mitigation strategy (cached HTTP for spectators)
- [x] Features listed (essential + good-to-have)
- [x] Full DB schema designed (11 tables, 6 views, triggers, RLS for every table, helper functions, realtime publication)
- [x] Schema written to `db.sql` — applied to live DB on 2026-05-07; the in-repo `db.sql` matches live (with the `prevent_self_promote` carve-out)
- [x] Decision: don't migrate CricHeroes data

### Phase 0 — Supabase setup ✅
- [x] Project provisioned (`hvc-scoring`, Mumbai region, ap-south-1, free tier)
- [x] `db.sql` executed — 11 tables, 6 views, RLS enabled, `supabase_realtime` publication on `balls`, `innings`, `matches`
- [x] Authentication → Sign In / Up: Email enabled, **email confirmation off** (dev), Site URL = `http://localhost:3000`
- [x] Storage buckets created (public): `tournament-logos`, `team-logos`, `player-photos`, `match-banners`
- [x] `.env.local` populated with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [x] Pavan bootstrapped as super admin via `pnpm exec supabase db query --linked "..."`
- [x] `prevent_self_promote()` trigger patched (live + `db.sql`) so future direct-DB super-admin grants don't blow up

### Phase 1 — Foundation ✅
- [x] **Stack scaffolded:** Next.js 16.2.5 + TypeScript + Tailwind v4 + shadcn/ui (base-nova preset). pnpm 10. Node 24 LTS via `.nvmrc`.
- [x] **Next 16 conventions adopted:** middleware → `src/proxy.ts` (function name `proxy`); async-only `cookies()` / `headers()` / `params`; Turbopack default.
- [x] **Supabase clients** at `src/lib/supabase/{client,server,middleware}.ts`. Typed with a hand-written `Database` stub at `src/lib/supabase/database.types.ts` covering the tables we actually query so far. Regenerate the full set with `pnpm gen:types` (requires `pnpm supabase login` — already done locally on Pavan's machine).
- [x] **Auth flows:** `/signup`, `/login`, `/me`, sign-out via Server Action. Top nav (`SiteNav`) reads `getUser()` server-side and shows email + sign-out when authed.
- [x] **Auth Server Actions** at `src/app/(auth)/actions.ts`: `signUp`, `signIn`, `signOut`. Inputs validated with zod.
- [x] **Auth helpers** at `src/lib/auth.ts`: `getSessionContext`, `requireUser`, `requireSuperAdmin` — read `profiles` + redirect.
- [x] **Sonner Toaster** mounted in root layout for surfacing action errors.

### Phase 4 — Scoring engine 🚧 (4a, 4b done; 4c–4e pending)
- [x] **4a** — `players.category` smallint column added (live DB, `db.sql`, types). Required dropdown on new/edit player forms. Category badge (C1/C2/C3 or red "no category" pill) on `/players` list. Drives bowling-order rules.
- [x] **4b** — Pure rules engine in `src/lib/scoring/`:
  - `types.ts` — `RuleSet`, `InningsState`, `BallInput`, `EngineError`, `ApplyBallResult`
  - `rules.ts` — `HVC_RULES` (Season 6 spec) + `STANDARD_RULES` fallback
  - `engine.ts` — `startInnings`, `applyBall`, `advanceBowler`, `setStriker`, `setNonStriker`. Pure functions; balls are append-only and replayable.
  - `__tests__/engine.test.ts` — 19 Vitest tests covering basic flow, wides + no-balls, free-hit lifecycle (consumption + survives wides), free-hit dismissal validation (rejects caught, accepts run-out + hit-wicket), Cat 1 special-over rules (stay-on-strike, first-dismissal-only, non-striker lock), wicket type validation (LBW rejected, byes rejected when disabled), bowler max-overs cap, innings completion (regular + super-over 2-wicket cap).
- [x] **4c** — `getRuleSet(json)` parser in `src/lib/scoring/parse.ts` with zod validation; falls back to `HVC_RULES` on missing/empty/invalid. `createTournament` action defaults `tournaments.rules` to `HVC_RULES` JSONB on insert.
- [x] **4d (part 1)** — `/matches/[matchId]/score` route built. Server actions: `startMatch` (gated on toss + both XIs picked; creates innings 1, flips match to `live`), `recordBall` (re-runs engine on the server, hard-stops on rule violation, computes over/ball/legal_seq), `voidLastBall` (single undo). Client scoreboard shows score/wickets/overs, free-hit + special-over badges, recent-balls strip, big tap-button grid (0/1/2/3/4/6, Wide, No-Ball, Bye, Wicket-with-type-and-player picker), and pre-ball pickers for striker/non-striker/bowler. Match detail page now links to **Start scoring** / **Score**.
- [x] **4d (part 2)** — Match lifecycle:
  - `state.ts` now loads all innings rows + derives a `phase` field: `pre_match | innings_1 | innings_break | innings_2 | match_complete | tied_pending_super_over`.
  - `recordBall` checks the chase target after each insert and marks innings 2 complete when the chasing side hits target. On innings-2 completion, `finalizeMatchInternal` auto-detects winner + win margin (by wickets if chased, by runs if defended) and flips `matches.status='completed'` with `winner_id`, `result_type`, `win_margin`. Tie → `result_type='tie'` with no winner; super over flow deferred.
  - `startSecondInnings` action: validates innings 1 done + no innings 2 yet, flips batting/bowling sides, sets `target = innings1.total_runs + 1`, points `current_innings_id` at the new innings.
  - `finalizeMatch` action exposed for manual finalization (mostly defensive — the auto path runs on innings-2 completion).
  - `InningsBreakPanel` — innings-1 summary + chase target + new openers picker for innings 2.
  - `MatchCompletePanel` — final scorecard + auto-finalize button + tie messaging.
- [x] **4d (part 2.5)** — Wide / No-ball runs keypads:
  - Wide: `Wide` / `Wide +1` / `Wide +2` / `Wide +4` (overthrows or boundary off wide) → records `extras = 1 + N` with `extra_type='wide'`.
  - No-ball: `No-ball` / `NB +1` / `NB +2` / `NB +4` / `NB +6` (penalty + bat runs) → records `runs_off_bat = N`, `extras = 1`, `extra_type='no_ball'`.
  - Wicket button moved to its own row so the inline panel has full width.
  - Two new engine tests (NB + 4 off bat, Wide + 4 boundary). 21/21 passing.
- [x] **4d (part 3a) — Super over flow**:
  - Phase machine extended: `tied_pending_super_over` → `super_over_1` → `super_over_break` → `super_over_2` → `super_over_decided` / `super_over_tied`.
  - `startSuperOverInnings` action creates innings 3 (team that batted 2nd in main match bats first) or innings 4 (chase with target). Engine's existing `is_super_over` flag enforces the 2-wicket cap and 1-over cap (already in HVC_RULES + applyBall).
  - `recordBall` now derives `is_super_over` from `innings.innings_number > 2` so the engine applies the right caps when validating.
  - `finalizeMatchInternal` checks for super-over innings first; sets `result_type='super_over'` with the right winner and margin (runs / wickets). Super-over tie → `result_type='tie'` with a "tied (super over also tied)" margin.
  - `SuperOverPanel` UI handles both starts (innings 3 + innings 4) with the chase target shown for innings 4.
  - `MatchCompletePanel` extended to surface super-over scorelines and the "super over also tied" case.
  - Recursive super overs (5/6/...) not implemented — HVC rules don't specify a tiebreaker beyond one super over.
- [ ] **4d (part 3b, deferred)** — Multi-ball undo stack (current undo is one-tap-per-ball; multi-step would be a stack visualization).
- [ ] **4e** — Supabase Edge Function: re-run engine on the server in a separate runtime layer, reject invalid balls (defence in depth — currently the Server Action does the validation, which is server-side already but bound to Next.js).

Encoded HVC ruleset reference: see `memory/project_hvc_rules.md` (per-machine), or just read `HVC_RULES` in `src/lib/scoring/rules.ts`.

### Phase 3 — Matches, playing XI, toss, admin assignment ✅
- [x] **`lookup_user_id_by_email(text)`** SECURITY DEFINER function added to live DB and `db.sql` so organizers can resolve emails to user_ids when adding scorers.
- [x] **Auth helpers expanded** in `src/lib/auth.ts`: `isTournamentOrganizer`, `isTournamentAdmin`, `requireOrganizer`, `requireTournamentAdmin`. Mirror the SQL helpers; used as page-level UX gates.
- [x] **Phase 2 actions retrofitted** to call `requireOrganizer(tournamentId)` instead of `requireSuperAdmin` / `requireUser` where RLS allows organizers. Pages now compute `canManage` via `isTournamentOrganizer(tournament.id, ctx)` so Edit/Add buttons appear for non-super-admin organizers too.
- [x] **Tournament admins UI** at `/tournaments/[slug]/admins`
  - Lists current organizers and scorers (display names from `profiles`).
  - Add admin by email + role; super-admin can add organizer or scorer; organizer can add scorer only.
  - Remove: super-admin removes anyone, organizer removes scorer only.
  - Friendly "user must sign up first" if the email isn't registered.
- [x] **Matches CRUD**
  - `/tournaments/[slug]/matches/new` (organizer) — pick stage, two distinct teams from the tournament's team list, schedule, venue, overs/players (defaults from tournament). `match_number` auto-incremented per tournament.
  - `/matches/[matchId]` public detail.
  - `/matches/[matchId]/edit` (organizer) — full update + status; **Delete** with cascade warning.
  - Matches section on tournament detail page (list with #, teams, stage, schedule, status).
- [x] **Toss** — inline form on match detail (organizer). Pick toss winner (Team A or B) + decision (bat/bowl). Validates winner is one of the two teams.
- [x] **Playing XI** — `/matches/[matchId]/xi/[teamId]` (organizer) checklist UI: tick to include, set batting order, mark captain/keeper/substitute. Validates ≤1 captain and ≤1 keeper. Save uses delete-then-insert for idempotency. Per-team summary cards on match detail.
- [x] **Database types** expanded with `matches`, `match_players`, and the `lookup_user_id_by_email` function entry.
- [x] **Schema simplification** — `teams.color` and `team_players.jersey_number` dropped from live DB, `db.sql`, generated types, action schemas, forms, and display surfaces. Pavan's "drop, don't optionalize" preference.

### Phase 2 — Tournaments / teams / players ✅
- [x] **Tournaments**
  - `/tournaments` public list
  - `/tournaments/new` (super-admin) → form auto-generates slug, retries on uniq violation
  - `/tournaments/[slug]` public detail
  - `/tournaments/[slug]/edit` (super-admin) — edit name/slug/format/status/overs/players/dates/venue/description, **delete** with `confirm()` (cascades to teams, matches, balls)
- [x] **Teams (per tournament)**
  - `/tournaments/[slug]/teams/new` — name, short_name (uppercased), color hex
  - Team cards on tournament detail
  - `/tournaments/[slug]/teams/[teamId]` detail with roster
  - `/tournaments/[slug]/teams/[teamId]/edit` — edit + delete
- [x] **Players (global registry)**
  - `/players` public list
  - `/players/new` — display name, phone, batting/bowling style enums. Supports `?teamId=&tournamentSlug=` query so create-from-roster page round-trips.
  - `/players/[playerId]/edit` — update; delete is super-admin only and surfaces a friendly FK-restrict error if the player is on any roster
- [x] **Roster management (`team_players`)**
  - Add player to team with jersey number + role (captain/vc/wk/player) on team detail page
  - Remove from roster (one-click)
- [x] **Site nav** links Tournaments + Players for everyone; super-admin sees Edit/New buttons through inline `getSessionContext()` checks.

---

## 9. What's next (build sequence)

Phases 0–3 done. Pick up at **Phase 4** (scoring engine). Each phase is roughly one sitting, except Phase 4 which is several.

### Phase 4 — Scoring engine ⚠️ *most critical phase*
1. **Box-cricket rules**: get the rule set from the user (still open — see §10). Encode as JSON shape applied via `tournaments.rules`.
2. **Pure rules-engine module** at `src/lib/scoring/engine.ts`: `applyBall(state, ball, ruleSet) → newState`.
   - Default standard cricket rules baked in.
   - Custom box-cricket variants overlay via `ruleSet`.
3. **Vitest unit tests** for the engine — wides, no-balls, free hits, byes, leg-byes, all wicket types, undo, last-man-standing, super over, etc.
4. **Ball-entry UI** for scorers (`/matches/[matchId]/score` or similar): mobile-friendly, big tap targets. Optimistic local state + server confirmation.
5. **Undo last ball**: void the row (`is_voided = true`), trigger recomputes innings, audit-log the action.
6. **Innings break / end-of-match** flow.
7. **Server-side validation** via Supabase Edge Function: re-runs rules engine, rejects invalid balls. Same module shared between client and edge.

### Phase 5 — Spectator view
- [x] **Part 1 — Live scorecard on the public match detail page**:
  - `LiveScorePanel` server component renders score / wickets / overs / RR for the active innings, plus required runs + balls + req-RR for chases, and the innings-1 summary once the second innings starts.
  - Per-batsman stats (R / B / 4s / 6s / SR) and per-bowler stats (O / R / W / Wd / Econ) computed inline from `balls` rows (no separate queries; mirrors the SQL views).
  - Recent-balls strip (current over + previous over) with W / wd / nb / b annotations.
  - Free-hit + special-over (cat1 / cat3) badges flow through.
  - **`AutoRefresh` client component** triggers `router.refresh()` every 2.5s while the match is live (cached HTTP polling — does NOT subscribe to Supabase realtime, staying under the 200 concurrent-connection cap).
  - Match-end banner with winner + win margin when `match.status='completed'`.
- [x] **Part 2 (in progress)** — Stats surfaces:
  - **Points table** as a `Standings` section on `/tournaments/[slug]`. Sourced from the `v_points_table` view + a typed cast (view isn't in the Database stub yet). Columns: P / W / L / T / NR / Pts. Sorted by points → points-per-match → name. NRR tie-break still TODO.
  - **Full scorecard** on `/matches/[id]` when `status='completed'`: per-innings batting card (Batter / Out / R / B / 4s / 6s / SR with full dismissal text — `c X b Y`, `b Y`, `run out (Z)` etc.), extras row (wd / nb / b breakdown + total), bowling card (Bowler / O / R / W / Wd / Nb / Econ). Computed inline from `balls` rows; mirrors v_innings_batting + v_innings_bowling.
  - DNB ("did not bat") detection: any XI member who never appeared as batter or non-striker.
- [x] **Part 2 (continued)** — Public `/players/[playerId]` page:
  - Career-totals card (R / B / 4s / 6s / SR / Wickets / Overs / Econ) summed across every tournament the player has touched. Sourced from the `v_player_tournament_stats` view via a typed cast.
  - Per-tournament breakdown table linking back to each tournament page.
  - `/players` list rows now link to the detail page; the inline Edit affordance is on the detail page itself for signed-in admins.
- [ ] **Part 2 (still deferred)** — Shareable Open Graph image for WhatsApp shares.

### Phase 6 — Polish & engagement (incremental)
- PWA setup (`next-pwa`).
- Shareable match URLs + Open Graph images.
- Commentary feed (auto + manual).
- Charts (Manhattan, worm, wagon wheel) — wagon wheel needs admin to tap a circle on ball entry.
- Push notifications (wicket / 50 / 100 / match end).
- Points table page (already a view in DB: `v_points_table`). NRR still TODO.
- Player career stats page (uses `v_player_tournament_stats`).
- Image upload UI for tournament/team/player logos (storage buckets exist).
- Replace `confirm()` with shadcn `AlertDialog` for destructive actions.
- Add edit/delete UIs for matches and innings in the same pattern.

---

## 10. Open questions / things we still need from the user

1. **Custom box cricket rules** — STILL TBD; the rules engine in Phase 4 is blocked until we have these:
   - How does the ball off netting work (out / dot / 1 run / etc.)?
   - Last man standing? (single batter continues alone?)
   - Wide / no-ball line definitions?
   - Are LBW / leg-byes used?
   - Free hit on no-ball?
   - Powerplay overs?
   - Mandatory bowling restrictions (max overs per bowler)?
   - Specific zone-based scoring (e.g., direct hit on back netting = boundary)?
   - Super over rules?
   - Anything else?
2. **Auth providers** — DECIDED 2026-05-07: email + password only for MVP. Google OAuth deferred.
3. **Domain / hosting** — still open. Pinning down before Phase 5 deploy.
4. **First tournament details** — name, dates, teams, rosters. Pavan can seed via the UI now.
5. **Branding** — logo, colors? Currently shadcn `neutral` base-nova theme. Easy to swap.

---

## 11. Things deliberately NOT in scope yet

If/when the user asks for these, the schema may need extension:

- **Match officials / umpires** — add `match_officials` table.
- **Sponsors / advertisements** — add `sponsors` table + tournament link.
- **Push notification subscriptions** — add `push_subscriptions` table.
- **Spectator chat / reactions** — add `match_messages` table.
- **Net Run Rate (NRR)** — extend `v_points_table` with overs-faced calc.
- **Player suspensions / disciplinary** — add `player_disciplinary_actions` table.
- **Match awards beyond Player of the Match** — add `match_awards` table.
- **Database backups** — Pro tier ($25/mo) for daily backups; for now, manual `pg_dump` from dashboard.
- **Seed data file** — none yet; will add `seed.sql` once first tournament is decided.

---

## 12. Project context for the AI assistant

If you're a Claude Code session reading this to pick up the work:

- The user's **collaboration style:** terse, prefers concise responses, doesn't need running commentary.
- They prefer **point-wise / structured explanations** over prose.
- They work **incrementally** — confirm direction before scaffolding code, don't jump ahead.
- They're comfortable with technical depth — you don't need to over-explain.
- **Don't suggest heavy/custom infra** — they explicitly chose Supabase for simplicity.
- **Don't add features beyond what was asked.** Three similar lines beats premature abstraction.

### Key files to read first when resuming
1. This file — `HANDOFF.md`
2. `db.sql` — full schema, ready to run
3. (Future) `package.json` once Next.js is scaffolded

### Memory in the prior author's Claude installation
The prior session stored a project memory at:
`/home/sudharshan/.claude/projects/-home-sudharshan-projects-own-hvc-scoring/memory/project_overview.md`

That memory is local to one machine and won't be available in your session — this `HANDOFF.md` replaces it.

---

## 13. Quick reference

- **Stack:** Next.js 16.2.5 (App Router, Turbopack default) + TS 5 + Tailwind v4 + shadcn/ui (base-nova) • Supabase (Postgres + Auth + Realtime + RLS) • Vercel + Supabase Cloud
- **Form stack:** react-hook-form + zod 3.25.76 + `@hookform/resolvers/zod` + shadcn `Form`
- **Node:** 24 LTS (`.nvmrc`). pnpm 10.
- **Free tier ceiling:** 200 concurrent realtime connections — work around with cached HTTP polling on spectator pages
- **Schema file:** `db.sql` (in repo root) — already applied to live DB; matches live (incl. patched `prevent_self_promote`)
- **Supabase project ref:** `cxysyglwooqmzcfvtmyl` · region `ap-south-1` · org owner `hvc.cricket@gmail.com`
- **Storage buckets:** `tournament-logos`, `team-logos`, `player-photos`, `match-banners` (created)
- **Realtime tables:** `balls`, `innings`, `matches` (already in `supabase_realtime` publication)
- **Default players-per-side:** 6 (box cricket)
- **Default overs:** 6 (configurable per tournament + per match)
- **Super admin (today):** `pavan.gautham17@gmail.com`

### Day-to-day commands

```bash
nvm use                       # Node 24 from .nvmrc
pnpm install
pnpm dev                      # localhost:3000
pnpm exec tsc --noEmit        # typecheck
pnpm gen:types                # regenerate src/lib/supabase/database.types.ts (needs supabase login + link)

# Run admin SQL against the live DB:
pnpm exec supabase db query --linked "select count(*) from tournaments;"
pnpm exec supabase db query --linked --file path/to/script.sql

# CLI auth (one-time):
pnpm exec supabase login
pnpm exec supabase link --project-ref cxysyglwooqmzcfvtmyl
```

### Gotchas / lessons captured this session

- **shadcn `add form` exits silently in non-TTY shells.** If `pnpm dlx shadcn add form` doesn't write a file, fetch the JSON from `https://ui.shadcn.com/r/styles/new-york-v4/form.json` and write `src/components/ui/form.tsx` from `files[0].content` (swap `radix-ui`/`registry/...` imports for the local equivalents).
- **Next 16 single-instance lockfile.** Only one `pnpm dev` per project. If a prior server crashed: `rm -f .next/dev/lock` then restart.
- **zod 4 ↔ resolvers v5 type skew.** Stay on zod 3.x in this project until `@hookform/resolvers` ships full zod-4 type support.
- **`auth.uid() is null` in admin paths.** Direct DB callers (Management API, dashboard SQL editor, service_role) have null `auth.uid()`. Any future SECURITY DEFINER trigger that gates by caller identity should early-return when `auth.uid() is null`.
- **Supabase CLI logs in to whichever account the *browser* has open** at the time of authorize — not whichever account the auto-generated token name implies. If `supabase projects list` shows the wrong projects, `supabase logout` and re-login with the correct browser session.

### File-tree snapshot (Phase 3 end)

```
src/
  app/
    layout.tsx                         # mounts SiteNav + Toaster
    page.tsx                           # placeholder landing
    (auth)/
      actions.ts                       # signUp / signIn / signOut
      layout.tsx
      login/page.tsx + login-form.tsx
      signup/page.tsx + signup-form.tsx
    me/page.tsx                        # protected — reads profiles row
    tournaments/
      actions.ts                       # createTournament / updateTournament / deleteTournament / updateTournamentStatus
      page.tsx                         # public list
      new/page.tsx + new-tournament-form.tsx
      [slug]/page.tsx                  # public detail + matches list + team grid
      [slug]/edit/page.tsx + edit-tournament-form.tsx
      [slug]/admins/                   # Phase 3 — organizer + scorer assignment
        actions.ts page.tsx add-admin-form.tsx remove-admin-button.tsx
      [slug]/matches/
        actions.ts                     # createMatch / updateMatch / deleteMatch / setToss
        new/page.tsx + new-match-form.tsx
      [slug]/teams/
        actions.ts                     # createTeam / updateTeam / deleteTeam / addPlayerToTeam / removePlayerFromTeam
        new/page.tsx + new-team-form.tsx
        [teamId]/page.tsx              # team + roster
        [teamId]/add-roster-form.tsx
        [teamId]/remove-roster-button.tsx
        [teamId]/edit/page.tsx + edit-team-form.tsx
    matches/
      [matchId]/
        page.tsx                       # public detail (teams, schedule, toss, XI)
        toss-form.tsx                  # client form for organizer to set toss
        xi-section.tsx                 # per-team XI cards
        edit/page.tsx + edit-match-form.tsx
        xi/[teamId]/
          actions.ts                   # savePlayingXI (delete-then-insert)
          page.tsx + pick-xi-form.tsx
    players/
      actions.ts                       # createPlayer / updatePlayer / deletePlayer
      page.tsx + new/page.tsx + new-player-form.tsx
      [playerId]/edit/page.tsx + edit-player-form.tsx
  components/
    site-nav.tsx                       # server component, getUser() → email + Sign out
    ui/                                # shadcn: button, card, input, label, sonner, form
  lib/
    auth.ts                            # getSessionContext / requireUser / requireSuperAdmin / requireOrganizer / requireTournamentAdmin / isTournamentOrganizer / isTournamentAdmin
    slug.ts                            # slugify()
    utils.ts                           # cn()
    supabase/
      client.ts server.ts middleware.ts
      database.types.ts                # hand-written stub; regenerate with pnpm gen:types
  proxy.ts                             # Next 16 proxy convention; calls updateSession()
db.sql                                 # schema (matches live; includes lookup_user_id_by_email + prevent_self_promote carve-out)
.env.local.example                     # NEXT_PUBLIC_SUPABASE_URL/ANON_KEY placeholders
.nvmrc                                 # 24
HANDOFF.md README.md AGENTS.md CLAUDE.md
```

---

*End of handoff. Good luck.*
