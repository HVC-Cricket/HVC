# HVC Scoring — Project Handoff

> **Purpose of this doc:** Bring a new collaborator (human or AI) fully up to speed on the HVC Scoring project — what it is, why we're building it, every decision made so far, the schema we've designed, what's done, and what's next. Upload this file at the start of a fresh Claude Code session and the assistant will have full context.

---

## 1. TL;DR

We are building **HVC Scoring**, a web app for live scoring and spectating a **box cricket tournament** with custom rules. Multiple admins enter ball-by-ball data; 50–60+ spectators (possibly more) follow scores live in their browsers.

**Status as of 2026-05-16:** Phases 0–3 done, Phase 4 done through 4d part 3a (super over flow). Phase 5 done through part 2 (live + completed scorecards, points table, player career page) plus dynamic OG. Phase 6 has PWA + service worker + IndexedDB durable write queue + per-match web push notifications + Manhattan/worm charts + optimistic UI on scoring (record + undo) + scorecard parity pass (fall of wickets, partnerships, did-not-bat, bowler dots/maidens) + auto Player-of-the-Match formula with admin override + a major scoring-page UX overhaul (merged slot tiles, engine-replay rotation, bowler-rule enforcement, modal wicket form). 2026-05-12 layered on: a scoreboard-level Category dropdown (Cat 1 / Cat 2 / Cat 3), Cat-1-must-face-Cat-1 enforcement at innings starts, wicket modal Delivery select, `balls_ball_in_over_range = 0..6`, engine slot-sync during replay. **2026-05-13** layered on: a mobile header fix (Tournaments / Players links now visible at all widths), a wicket-on-extra display fix (`1wd+W` etc), a two-tier refactor pass that extracted shared scoring helpers (`stats.ts`, `replay.ts`) plus split `scoreboard.tsx` / `actions.ts` into smaller siblings (`wicket-button.tsx`, `record-ball-helpers.ts`, `use-offline-queue.ts`), and a **multi-scorer lock with permission-based takeover** (`primary_scorer_id` / `pending_scorer_request_id` columns on matches; only one admin records at a time; second admin files a Request → current holder Allows / Denies; auto-expires after 2 min of no heartbeat). Same day also brought UX + rule additions: default over Category remapped (over 2 → Cat 3, over 3+ → Cat 2); Cat 1/3 **repeat-dismissal rule** (`balls.counts_for_innings_total` — bowler credited each time, team total only on the first dismissal); wicket modal **Runs picker + "Runs are byes" toggle** for the no-ball-byes-wicket case; main panel collapsed to single Wide/No-ball/Bye/Overthrow buttons with inline 0–6 pickers; engine fix to **rotate strike on non-legal odd-run deliveries**; mobile slot tiles split 2/1 (striker + non-striker on row 1, bowler on row 2); "This over" pills moved inside the Bowler tile, "Previous over" panel at the bottom of the page; global site nav hidden on mobile when on the score route; "Record ball" header dropped; **previous-over bowler disabled** in the bowler picker; **last-man-standing rule** (HVC: lone batter keeps batting until dismissed, strike doesn't rotate, non-striker slot locked, orange badge in the header); manual **⇄ Swap** button for striker / non-striker; `pnpm-workspace.yaml` `onlyBuiltDependencies` malformed-string fixed. **2026-05-14** polished the last-man UX: striker is now **auto-picked** as the lone live batter when the rule kicks in; non-striker slot is **cleared** instead of held when it would conflict with the live batter, then accepts any dismissed batter as the dummy via a relaxed picker. Same day: wicket modal **Player out** dropdown now defaults to "Striker" for every dismissal except **run-out**, which clears the field and forces an explicit pick (with a Save-blocking toast if left empty). **2026-05-15** polished the slot tiles themselves: textual labels removed; **bat icon** before each batter (cyan for striker, dim for non-striker); **ball icon** before the bowler; bowler stats inlined onto the same row as the name; `1×4 6×6` boundary count dropped from the batter stats line. Player-registry writes hardened on 2026-05-09: only super-admins and tournament organizers can create/edit players (was: any signed-in user). Dead `updateTournamentStatus` action removed; status changes flow through the gated `updateTournament` action. Two super admins bootstrapped (`pavan.gautham17@gmail.com`, `sudarshan61kv@gmail.com`).

**2026-05-16 — Historical data scraped + importer written.** Reversing the original "don't migrate CricHeroes" decision, all 6 prior HVC seasons (2021–2025) were scraped from CricHeroes' public `_next/data/*.json` endpoints. Schema-shaped CSVs live under `data/cricheroes/csv/`; the scraper is `scripts/scrape_cricheroes.py`; the importer is `scripts/import_cricheroes.ts` (run via `pnpm run seed:cricheroes`). See §14.

**2026-05-16 — Two-environment split done.** Prod = `cxysyglwooqmzcfvtmyl` (now holds the 6 historical CricHeroes seasons; was wiped of test data first). Dev = `clqdimzthzcpurtwhtej` (empty schema, all migrations applied, 5 storage buckets ready). Two checked-out-but-gitignored env templates — `.env.dev` and `.env.prod` — hold both sets of creds; flip the active env by `cp .env.dev .env.local` (or `.env.prod`). Still pending: super-admin re-bootstrap on prod (was wiped — sign up + Management-API promote), `dev` branch creation, Vercel preview env-var scoping. See §15.

**2026-05-16 (later) — Historical scorecard fallback.** Investigation confirmed cricheroes does not expose complete ball-by-ball for HVC seasons 1–6 (commentary feed misses real dismissals + wide/no-ball penalties). Shipped 3 new tables — `historical_match_batting/bowling/fall_of_wickets` (migration `20260516020000_*`) — populated by extending the importer. New `historical-scorecard.tsx` server component renders from these when `balls` is empty; `full-scorecard.tsx` auto-delegates. Spectator scorecards now render for historical matches. See §15 "Historical scorecard rendering".

**2026-05-16 (evening) — Spectator UI polish + identity sync.** Tournament home now leads with a Champion + Runner-up + Player-of-the-Tournament hero (only on completed tournaments). Homepage dropped its "no matches live" empty state — always populated now with a linked-user profile strip + past-tournaments grid. `/me` and `/players/[id]` share a new `PlayerCareerSection` server component so the linked user sees the same Career + By-tournament card on both pages (no more 8-vs-9-stat divergence). Two new triggers (`20260516040000_sync_avatar_photo` + `20260516050000_sync_display_name`) keep `profiles.avatar_url ↔ players.photo_url` and `profiles.display_name ↔ players.display_name` in sync for linked accounts — bidirectional, recursion-safe, with one-shot backfill. Match-list rows show full team names with "Team " prefix stripped + 20 cricheroes team logos backfilled to full URLs. `/players` list routes the signed-in user's own row to `/me` instead of `/players/[id]`. See §16.

**2026-05-17 — Cricheroes scrape pagination fix + league-only standings.** Earlier scrape silently captured only page 1 (12 matches) per tournament — cricheroes' `/api/v1/match/get-tournament-matches` API silently re-serves page 1 unless the server-minted `datetime` cursor from page 1 is replayed on subsequent requests. Added `fetch_tournament_matches()` paginator to `scripts/scrape_cricheroes.py` + required API headers. Re-imported all 6 seasons with `--reset`; counts roughly doubled (matches 71→131, match_players 925→1729, innings 142→266, historical_batting 850→1602, historical_bowling 776→1446). New migration `20260516100000_points_table_league_only.sql` restricts `v_points_table` to `stage='group'` so standings show only the league phase (matches cricheroes' "League Matches" table exactly). Sudharshan player re-linked to user account (display_name changed from "Sudharshan V" → "Sudharshan" after re-scrape). See §18.

**2026-05-17 — Cricheroes leaderboard parity (MVP + POTM + Stats).** The MVP tab on historical seasons was tied on team-bonus only (every Hoysala player at 80 for S6) because our HVC formula was running against the empty `balls` table. Switched to mirroring cricheroes' published MVP rows verbatim: new `historical_tournament_mvp` table (migration `20260517000000_*` — **prod only; dev didn't need it**) holds 274 rows across S1–S6 with cricheroes' decimal totals (33.003, 22.400, …). `scripts/scrape_cricheroes.py` extended with `fetch_mvp_leaderboard()` hitting `api.cricheroes.in/api/v1/mvp/get-tournament-player-mvp/{tid}`. New `scripts/import_cricheroes_mvp.ts` is a targeted importer that resolves existing UUIDs by tournament-slug + team-name + player-display_name, so prod can be loaded without `--reset`-ing other historical data. `tournament-mvp.tsx` falls back to the new table; `tournament-champion.tsx` POTM card pulls rank 1 from it (Mady for S5, not the POM-count winner Ashrith Kashyap). Same day the Stats tab got a full historical fallback computing from `historical_match_batting/bowling`, plus a cricheroes-style BAT/BOWL/FIELD pill layout with a Style dropdown (7 batting + 7 bowling + 3 fielding leaderboards), pagination at 10 rows/page, and a constrained player column that wraps long names. FIELD section hidden on historical seasons (no per-ball fielder credits in the cricheroes feed). Plus several morning UI tweaks: match-complete panel now has an explicit "Finish match" + "Undo last ball" pair instead of auto-finalizing the last ball; scoreboard chase line reads "Need X runs from Y balls"; Pick XI gained a select-all header checkbox; homepage innings join disambiguated via `innings!innings_match_id_fkey`. See §17.

**2026-05-17 (late, batch 2).** Sticky bottom CTA on the match page — "Start scoring this match" is now pinned to the viewport bottom for scheduled matches (was inline under the header; required scrolling back up after reading Details / Toss / squad). Sudharshan added a **pending-finalize gate for innings 1** (`commit df6db21`) — mirrors the match-complete pattern: `recordBall` flags `is_complete=true` but leaves `ended_at` null at the natural end of innings 1, surfacing a new `InningsFinishPanel` with Finish innings + Undo last ball; `finalizeInnings` stamps `ended_at` on confirm. Same day: **Cat-matching auto-pick on category change** (`commit e20febd`) — when the over-Category dropdown flips to Cat 1 or Cat 3, the striker and bowler slot tiles auto-fill with an eligible player of that category (first non-dismissed XI member; first bowler not in `disabledBowlerIds`). Cat 2 is "any", no-op. See §20.

**2026-05-17 (late, batch 5) — Page-level refactor pass.** Audit across all 22 pages under `src/app/`. No functional changes; verified with `tsc --noEmit`, `vitest run` (21/21), `next build`, and `eslint src/app` (baseline 27 problems / 14 errors / 13 warnings — all pre-existing, unchanged after the refactor). Extracted helpers that hit the "≥2 callers, ≥10 LOC each" bar:

- **`src/lib/format.ts`** (new) — `formatScheduledAt` / `formatUpcomingTime` / `formatDateRange` / `formatMatchTime` / `formatEnumLabel`. Each was inlined in 1–4 page files; same behaviour, single source of truth. `formatEnumLabel(value)` replaces 15 `.replace(/_/g, " ")` callsites for snake_case enum rendering (match stages, wicket types, batting/bowling styles, team-player roles, tournament format, etc.).
- **`src/lib/utils.ts`** — added `getTeamInitials(shortName)` next to the existing `getInitials()` helper. Replaces 6 inline `team.short_name.slice(0,2).toUpperCase()` calls (home live cards, upcoming rows, recent rows, match detail, tournament detail).
- **`src/app/(auth)/or-divider.tsx`** (new) — was duplicated verbatim in `login/page.tsx` + `signup/page.tsx`. Now imported from both.
- **`src/app/home-types.ts`** (new) + **`src/app/live-match-card.tsx`** (new) — `src/app/page.tsx` shrank from 561 → 360 LOC. `LiveMatchCard` + its private `TeamLine` helper moved to a sibling file; view-model types (`TeamView`, `InningsScore`, `LiveMatchView`, `UpcomingMatchView`, `RecentMatchView`) moved to a types file so home page + sibling can share them without circular imports. The remaining row helpers (`UpcomingMatchRow`, `RecentMatchRow`, `ResultLine`, `TeamBadge`) stayed inline — single-use and small enough that splitting would add noise.

**Skipped (below the threshold)** — `SectionSkeleton` (used in only one file despite the audit suggesting otherwise), `MS_PER_DAY` 24h constant (single callsite on the home page), `displayTeamName()` + `Stat` (single-use helpers on tournament detail), shared `TeamView` type promotion to `src/lib/types/` (still only defined in one home-types module). Premature abstraction is worse than the original duplication.

Commit `d610f09`; 21 files changed; +365 / −317 LOC.

**2026-05-17 (late, batch 4) — Repeated super overs uncapped.** Live testing surfaced that starting a 2nd super over (innings 5) failed with `new row for relation "innings" violates check constraint "innings_innings_number_check"`. The original schema capped `innings_number between 1 and 4` from when the engine only handled one super-over pair; the recent "Super-over correctness pass: 1-over cap, no Cat rules, re-super on tie" commit (`e3b1989`) wired up the TS side for the full chain (3/4 → 5/6 → 7/8 …) but didn't lift the DB cap. Migration `20260517020000_innings_number_uncap.sql` drops the upper bound. `finalizeMatchInternal` switched from hard-coded `innings_number === 3` / `=== 4` look-ups to a loop that finds the highest complete pair — earlier pairs are tied by construction (`startSuperOverInnings` already enforces "previous pair must be tied" before allowing a new pair to begin), so the last pair is always the decisive one. Match-complete panel renders every leg in Final scores; label switches from "super over" to "super over N" when more than one pair was played. Cricket rules: ICC repeats super overs until a winner emerges — no fixed cap. Tests still pass (21/21). See §19.

**2026-05-17 (late, batch 3) — Scorers can actually pick XI.** Follow-up to the pre-match-flow polish below: the score page was rendering toss + Pick XI inline for scorers, but clicking Pick XI bounced them to `/`. Root cause was a permission mismatch — the score page passes `canManage` true into `XISection` (it's a scorer-or-organizer page), but the XI route + `savePlayingXI` + `setToss` actions all called `requireOrganizer`, and on top of that `matches_write` / `mp_write` RLS were both organizer-only. Loosened all three app gates to `requireTournamentAdmin`, kept `requireOrganizer` on every other action in `tournaments/[slug]/matches/actions.ts` (editing match meta, deleting a match, etc.). New migration `20260517010000_scorer_can_set_toss_and_xi.sql`: `mp_write` switched to `is_tournament_admin` (same as `innings` / `balls`); `matches_write` split into `matches_insert` (organizer), `matches_update` (admin — covers toss + live state), `matches_delete` (organizer) so scorers can't fabricate or wipe matches via the REST API. db.sql updated. See §19.

**2026-05-17 (late) — Scorer pre-match flow + NRR data fix.** Live testing surfaced a stack of papercuts in the scheduled-match → first-ball path. "Start scoring" inline with Activity/Edit on the match header read like a tab strip — scorers thought they were already in a "Start scoring" view; lifted it out into a full-width primary CTA card with Play + ChevronRight icons. The score page used to redirect blocked scorers ("Set toss on the match page first") — it now renders `TossForm` + `XISection` inline so the entire pre-scoring checklist is on one page. `TossForm` itself dropped its Save button — picking both selects auto-commits, then collapses to a `Team · bat first ✓ Edit` summary. Pick XI lost the Order / C / WK columns (captain is a roster role on the squad, keeper rotates per delivery, batting order is live) — table is now In / Player / Sub only, and Save XI calls `router.back()` so the scorer returns to wherever they came from. Plus an NRR bug fix: the `innings → matches` PostgREST embed in `points-table-section.tsx`, `lib/standings.ts`, and `tournament-champion.tsx` was ambiguous (matches has two FKs back — `innings_match_id_fkey` for the parent + `matches_current_innings_fk` for the live-innings pointer), so the queries silently 400'd with PGRST201 and Standings rendered `—` for every team's NRR. Pinned the embeds to `matches!innings_match_id_fkey`. Same root cause as the homepage embed fix earlier in the day. Team column on the points table also pinned to 130/180px so PTS + NRR have room on mobile. Also seeded dev with a second test tournament (`pranavs-tournament`, 6 teams / 42 players / 15 round-robin matches, IPL-style playoff auto-schedule). See §19.

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

- ~~Commentary feed (auto + manual per ball)~~ ✅ auto shipped 2026-05-13; manual scorer notes deferred
- Required run rate / projected score
- Partnership tracker + fall-of-wickets
- Manhattan / worm chart
- Wagon wheel (where each ball was hit) — admin taps a circle
- Pitch map
- Shareable match link + Open Graph image (WhatsApp shares look good)
- Push notifications (wicket / 50 / 100 / match end)
- ~~PWA / offline scoring with sync~~ ✅ shipped (PWA in 2026-05-08, full SW + IndexedDB durable write queue in 2026-05-10)
- ~~Push notifications (wicket / 50 / 100 / match end)~~ ✅ shipped 2026-05-10 (per-match opt-in; also includes innings break)
- Player career stats across tournaments
- Tournament series mode + points table
- ~~**Multi-scorer with conflict prevention**~~ ✅ shipped 2026-05-13 — permission-based takeover (only the current holder can transfer, with a 2-min idle expiry safety net)
- **Tournament-end awards screen** — top run scorer, top wicket taker, best bowling figures, best batting innings, best partnership, most boundaries, most economical bowler (min 4 overs), most catches, Player of the Tournament (rolled-up POTM points). Visible on `/tournaments/[slug]` when the tournament is `completed`. All pure-derived from existing `balls` + `match_players` data — no schema change. ~3-4 hrs.
- ~~Audit log of who scored what~~ ✅ shipped 2026-05-13 — admin-gated page at `/matches/[matchId]/activity` rendering recorded + voided ball events in reverse chronological order

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
- `v_points_table` — standings per tournament: P/W/L/T/NR + points (2 per W, 1 per T/NR). NRR is computed in the Next.js layer (`PointsTableSection`) by aggregating innings 1/2 totals per match — full-quota overs when a team is bowled out, super overs excluded.
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
| players | All | **Insert/update: super-admin OR organizer of any tournament. Delete: super-admin only.** Scorers and roleless auth users have no write access — the registry stays curated. |
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
| 2026-05-09 | Bootstrapped `sudarshan61kv@gmail.com` as the second super admin (later removed) | Co-maintainer needs full access. Used the same Management-API `update profiles set is_super_admin = true` pattern documented in README. |
| 2026-05-09 | Removed `sudarshan61kv@gmail.com` and `hvc.cricket@gmail.com` from `auth.users` (cascade-cleared their `profiles` rows) | Cleanup before any real-user signups. Neither had any FK references (no tournament_admins / players / audit / balls). Back to one super admin. |
| 2026-05-09 | **Tightened player-registry writes**: `players_insert_admin` / `players_update_admin` policies now require super-admin OR `tournament_admins.role = 'organizer'` (was: any tournament admin). Scorers and roleless auth users can no longer create or edit players. | The registry should be curated, not free-for-all. Original RLS was too broad — any authenticated user passing the `requireUser()` Server Action gate could mutate any player row. Server Actions and UI updated to match (see §13 file-tree changes). |
| 2026-05-09 | Added `players.linked_user_id → profiles(id)` link with **partial unique index** `ux_players_linked_user_id` (only enforced where `linked_user_id is not null`) | A super-admin/organizer/scorer who plays box cricket needs both a profile *and* a player record. The link lets `/me` and the player detail page show "Linked to: email". Nullable + unique-when-set: multiple unlinked players are fine; one auth user has at most one player. |
| 2026-05-09 | Added `lookup_email_by_user_id(uuid)` SECURITY DEFINER helper (authenticated only) | Symmetric to `lookup_user_id_by_email`. Used to prefill the linked-email field on the player edit form so an organizer can see the current link without service-role access. |
| 2026-05-09 | Optional `linked_email` field on player create/update forms; resolved via the email RPC and stored as `linked_user_id` | Two coexisting flows for getting players into the system: (a) anyone signs up via `/signup` (auth account only — no auto player record), (b) organizers/super-admins create the player record and **optionally link it** to an existing user account by email. Keeps the "only org/super can add players" rule absolute while still supporting players who happen to be admins. |
| 2026-05-09 | Re-promoted `sudarshan61kv@gmail.com` to super admin after a fresh signup | Same person as the previous super-admin row that we deleted earlier in the day — they signed up again with a new `auth.users` id (`75afe1f9-…`) and need full access for co-maintenance. Pattern unchanged: `update profiles set is_super_admin = true …` via Management API. |
| 2026-05-09 | **Deleted `updateTournamentStatus` Server Action** (commit `f1d3179`) | Dead code: nothing in `src/` called it, and `updateTournament` already covers status changes via the full edit form with a correct `requireOrganizer(tournamentId)` gate. The deleted action only had `requireUser()`, which was looser than the underlying RLS policy — a logic-gap smell. Removing it shrinks the action surface area without changing any wired behavior. |
| 2026-05-12 | **Scoreboard `Category` dropdown drives per-over restrictions; Cat 1 first-over rule enforced at innings start** | Scorer-facing surface for HVC's category-based bowling order. Default tracks over number (1 → Cat 1; 2 → Cat 2; 3+ → Cat 3) and re-applies on each over boundary while letting the scorer override mid-over. Cat 1 / Cat 3 restrict striker + bowler pickers and `submit()` aborts on mismatch. Cat 2 = open. At innings 1 + 2 start (`startMatch`, `startSecondInnings`), if the chosen striker is Cat 1 the bowler must be Cat 1 too — enforced both client-side (before round-trip) and server-side. Super-overs exempt from the start-of-innings check. |
| 2026-05-12 | **Engine: `special_over` derives from `striker.category` alone; cleared at end-of-over swap** | Existing `computeSpecialOverContext` required `over_number === cat1_over` (=1) or `cat3_over` (=2). With the new scorer-driven Category dropdown, a Cat 1 over can happen in any over — derive from striker.category instead. The dropdown's filter ensures striker.category matches the dropdown when Cat 1 / Cat 3. Also clear `special_over` inside `applyBall` at the end-of-over swap so a dismissed special batter swapped into the non-striker slot is correctly blanked from the next over's lineup (otherwise the loader's `stillSpecialStay` check would keep them visible). `cat1_over` / `cat3_over` rule fields are now informational only. All 21 engine tests still pass. |
| 2026-05-12 | **Wicket-on-no-ball / wide / bye via wicket modal** | The `WicketButton` modal grew a `Delivery` select (Legal / No-ball / Wide / Bye). Selection plumbs through `onSubmit` into the `recordBall` payload as `extra_type` + `extras = 1`. Run-out on a no-ball now records as one ball with `is_wicket=true, extra_type='no_ball', extras=1`. UI doesn't yet filter wicket types per delivery (cricket disallows e.g. `bowled` on a no-ball); scorer is trusted. |
| 2026-05-12 | **`balls_ball_in_over_range` relaxed to `0..6`** | Engine semantic for `ball_in_over` is "legal balls completed in the over so far" (= 0 at start of over). A wide / no-ball as the first delivery of an innings or over is recorded with `ball_in_over = 0`. Old constraint `1..6` violated. Migration `supabase/migrations/20260512000000_balls_in_over_allow_zero.sql`; `db.sql` updated. |
| 2026-05-12 | **Engine slot-sync (`setStriker`/`setNonStriker`) during replay** | `applyBall` only rotates `striker_id` / `non_striker_id` via cricket rules — it doesn't accept new IDs from `BallInput`. So if a scorer manually picked a new non-striker (after a run-out), the engine's slot stayed pinned to the dismissed player. Subsequent revalidation saw the dismissed batter in `engine.dismissed` and blanked them via the new state-based `isDismissed` check — overwriting the scorer's pick. `state.ts` (loader replay) and `actions.ts` (validator replay + pre-validation block) now sync engine slots from each ball's `batter_id` / `non_striker_id` and from the new ball's input before `applyBall`. |
| 2026-05-12 | **Nav heading: "HVC Scoring" → "HVC Tournament Scoring"** | Just the `<Link>` in `src/components/site-nav.tsx`. Other "HVC Scoring" copy (page title, OG images, manifest) intentionally left as-is for now. |
| 2026-05-13 | **Default over Category remapped: over 1 → Cat 1, over 2 → Cat 3, over 3+ → Cat 2** | The earlier mapping (`over 2 → Cat 2`) didn't match the actual HVC bowling order — Cat 3 plays in over 2, not over 3+. `defaultOverCategory(overNumber)` in `scoreboard.tsx` updated. Scorer can still override the dropdown per over. |
| 2026-05-13 | **Cat 1/3 repeat-dismissal rule: bowler credited each time, team total only once** | When a Cat 1 / Cat 3 batter is dismissed multiple times inside their special over, the bowler tally goes up for each dismissal (their column shows 3W if bowled 3 times) but the team's innings wicket total stays at 1 (matches HVC convention). New column `balls.counts_for_innings_total boolean not null default true`; `recordBall` flags repeat-dismissal rows with `false`; `recompute_innings` filters `total_wickets` on the column. Bowler stats are unaffected — they're computed in TS from balls rows directly via `wicket_type`. Migration `supabase/migrations/20260513000000_balls_counts_for_innings_total.sql`. |
| 2026-05-13 | **Wicket modal: Runs picker + "Runs are byes" toggle** | Wicket modal grew a Runs row (0–4 buttons) so wickets accompanied by bat runs / wide-extras / byes record on one ball. When `Delivery = No-ball`, a "Runs are byes (not off the bat)" checkbox appears — toggling it routes the chosen N into `extras` instead of `runs_off_bat`, so the no-ball-byes-wicket case (e.g. NB + 2 byes + run-out) doesn't credit the batter. The hint label under "Runs" updates dynamically per delivery type. |
| 2026-05-13 | **Main scoring panel: single Wide/No-ball/Bye/Overthrow buttons with inline pickers** | Replaced ~17 individual buttons (Wide ×4, NB ×5, Bye ×4, NB-Bye ×4) with a single row of 3-4 buttons, each expanding into an inline 0–6 picker on tap. No-ball picker carries the same "Runs are byes" toggle as the wicket modal. New **Overthrow** button picks 1–7 runs off the bat (covers the 5 / 7 cases the main row doesn't expose). Active button gets a filled style while its picker is open. |
| 2026-05-13 | **Engine: strike rotation on non-legal odd-run deliveries** | `applyBall` previously rotated only when `isLegalBall || isBye`, so `NB +1` / `NB +3` didn't swap strike. Now computes `rotationRuns = runs_off_bat + (bye ? extras : 0) + ((no_ball || wide) ? max(0, extras - 1) : 0)` — the 1-run penalty doesn't count, the running runs do. Swaps if `rotationRuns` is odd. Cat 1 / Cat 3 special-batter "stay" override unchanged. 21/21 engine tests still pass. |
| 2026-05-13 | **Mobile scoring layout: striker + non-striker share row 1, bowler spans row 2** | Slot grid was `sm:grid-cols-3` (1-col on mobile, stacked); now `grid-cols-2 sm:grid-cols-3` with the Bowler tile wrapper using `col-span-2 sm:col-span-1`. Tablet+ layout unchanged. |
| 2026-05-13 | **Recent-balls relocation: "This over" inside the Bowler tile; "Previous over" at the bottom** | Top-of-screen RecentBalls card removed. `renderBallPill` + `BallStrip` hoisted to module scope; `SlotPicker` gained a `footer` prop that renders below the stats line with a divider — used by the Bowler tile to show the current-over pill strip. A separate small "Previous over" panel sits at the very bottom of the scoreboard, only renders when there's a previous over. |
| 2026-05-13 | **Hide global site nav on mobile when on the score page** | New `src/components/site-nav-shell.tsx` (client component) reads `usePathname()` and wraps `<SiteNav />` with `hidden sm:block` when the route matches `^/matches/[^/]+/score`. Frees the entire phone viewport for scoring. Tablet+ shows the nav as before. Other routes unaffected. |
| 2026-05-13 | **"Record ball" card header dropped** | The Card wrapping the ball-entry buttons no longer carries a title/description. Header renders conditionally — only when an "Offline · queuing" or "Saving N…" pill needs to surface. Idle state goes straight to the run buttons. Saves a vertical row on phones. |
| 2026-05-13 | **Previous-over bowler disabled in the bowler picker** | Server-side `validateBowlerRules` already rejected "same bowler bowls back-to-back overs" but the UI only surfaced the error AFTER picking + tapping a run. The bowler `SlotPicker` now adds the just-finished over's `bowler_id` to `disabledIds` at over boundaries (innings 1 + 2 only, matching the server rule). State loader nulls `state.active.bowler_id` at the boundary, so we detect the case from local state. Super overs unaffected. |
| 2026-05-13 | **Last-man-standing rule** | Box-cricket convention: when 6 of 7 batters are dismissed the lone batter keeps batting until they're also out. New `RuleSet.last_man_standing` flag (HVC: true, standard: false). When set: engine's `wicketsCap` becomes `players_per_side` (not `players_per_side - 1`); strike rotation on odd runs is disabled; end-of-over swap is skipped. Loader keeps the dismissed non-striker in their slot (acts as a "dummy"); UI locks the non-striker `SlotPicker` (`disabledIds` covers every option except the current value). New orange **"Last man standing"** pill in the top scoreboard card. Super overs (innings 3/4) exempt. 21/21 engine tests still pass. |
| 2026-05-13 | **Manual Swap button (striker ↔ non-striker)** | Small `⇄ Swap` button at the right end of the Category row in the scoreboard header. Swaps local `strikerId` / `nonStrikerId` so the next ball uses the new arrangement; engine picks it up via the existing `setStriker` / `setNonStriker` replay calls. Used when the engine's automatic rotation doesn't match what actually happened on the field (batsmen crossing on a wicket, scorer noticing the wrong batter on strike). Disabled when both slots are empty or in last-man-standing mode (the non-striker slot is locked anyway). Mobile shows just the icon; tablet+ shows the icon + "Swap" label. |
| 2026-05-13 | **`pnpm-workspace.yaml`: `onlyBuiltDependencies` fixed** | Was `onlyBuiltDependencies: '["supabase"]'` (a YAML *string*, parsed by pnpm as opaque text). Converted to a proper YAML list — `onlyBuiltDependencies: - supabase`. Now `supabase`'s postinstall actually runs on `pnpm install`, the platform-specific binary is downloaded into `node_modules/.bin/supabase`, and the "Failed to create bin" warnings stop. |
| 2026-05-14 | **Last-man-standing UX polish** | The 2026-05-13 version landed but the scorer's experience needed two follow-ups. (1) **Auto-pick striker:** when last-man mode kicks in, `state.ts` now looks up the batting-XI member not in `engine.dismissed` and not in `engine.barred_batters` and fills `striker_id` with them automatically (whenever the slot would otherwise be null or pointing to a dismissed player). (2) **Force non-striker empty when it'd conflict:** loader clears `non_striker_id` when it points to a *non-dismissed* player — that can only be the lone live batter (= same as the new striker), so leaving it would put the same person at both ends. (3) **Non-striker picker relaxed:** in last-man mode the non-striker `SlotPicker` no longer locks the slot — only the live striker is in `disabledIds`, so any dismissed batter is selectable as the "dummy". `dismissedIds` still adds the "(out)" suffix so the scorer sees who's out. |
| 2026-05-14 | **Wicket modal: Player out auto-defaults from wicket type** | "Player out" used to always default to "Striker", which was fine for bowled / caught / stumped / etc. but a quiet trap for run-outs (the scorer could miss the dropdown and accidentally record the striker as out when the non-striker was the one run out). Modal now defaults to "Striker" for every dismissal type **except** `run_out`, which clears the field and shows a "Select…" placeholder — forcing an explicit pick. A `useEffect` on the wicket-type select drives the reset. Save wicket is blocked with a toast (`"Pick who's out — striker or non-striker"`) when the field is empty. `close()` also resets Type back to bowled and Player out back to striker, so the next open starts clean. |
| 2026-05-15 | **Scoreboard slot-tile polish: icons + cyan striker + inline bowler stats** | Role identification on the slot tiles now relies on icon + colour rather than a textual label. (1) The "Striker" / "Non-striker" / "Bowler" labels are gone. (2) Small inline-SVG **bat icon** before each batter name — `text-cyan-600 dark:text-cyan-400` for the striker, `text-muted-foreground/40` for the non-striker (dim = "not on strike"). (3) Striker's player name uses the same cyan colour so the pair is visually unmistakable; non-striker stays in default foreground. (4) **Ball icon** (circle + faint seam SVG) before the bowler name. (5) The bowler's stats (`0/4 (0.3) · econ 12.0`) are now inlined on the same row as the name, right-aligned via `ml-auto`. (6) Batter stats line dropped the `1×4 6×6` boundary count — too much detail for the live tile, still surfaces in the full scorecard. `SlotPicker` gained `leadingIcon` + `inlineStats` props. |
| 2026-05-16 | **Reverse: scrape CricHeroes for Seasons 1–6 (overrides 2026-05-06 "drop" decision).** | Season 7 launches with continuity expectations — career stats, head-to-head, team rosters. Found that CricHeroes' Next.js `_next/data/<buildId>/.../*.json` endpoints are public (no auth, no ToS-violating session hijack). 71/72 matches across 6 seasons saved as schema-shaped CSVs plus raw JSON dumps. One match (`12170963`, Season 5 group stage) is genuinely deleted on CricHeroes' side. Ball-by-ball is NOT exposed — only innings/batting/bowling aggregates. Scraper: `scripts/scrape_cricheroes.py`. CSVs: `data/cricheroes/csv/`. See §14 for the import pipeline. |
| 2026-05-16 | **Split into prod + dev Supabase environments** (planned; mid-flight) | Current single project is double-duty for testing + the public spectator surface — with Season 7 approaching, real testing needs isolation. Existing project (`cxysyglwooqmzcfvtmyl`) becomes prod tied to `main`; new project becomes dev tied to a new `dev` branch + Vercel previews. Code-side changes done (importer, `gen:types:dev`/`gen:types:prod`, `tsx` dep, esbuild build allowlist). Dashboard provisioning + Vercel env-var scoping + `dev` branch creation pending user. **Prod wipe gated on coworker's pending pushes landing on `main` + dev validation.** See §15 + plan file `/home/sudharshan/.claude/plans/swift-zooming-piglet.md`. |
| 2026-05-16 | **profiles ↔ players identity sync via DB triggers** | Linked users had photo + display_name fields on both sides that were independent — editing one didn't reflect on the other, so /me looked stale after uploading on /players/[id]/edit and vice versa. Two AFTER UPDATE triggers per column (avatar/photo + display_name) now mirror writes; `is distinct from` guards keep cross-propagation from recursing. Backfill rule: profile.display_name wins where both are set and different; the longer/non-null side wins for photo. Migrations `20260516040000_sync_avatar_photo.sql` + `20260516050000_sync_display_name.sql`. See §16. |
| 2026-05-16 | **Unified profile UI: /me and /players/[id] render the same career section** | Linked users were seeing different stat shapes on /me (8 stats, 4×2 grid) vs /players/[id] (9 stats including Innings + full per-tournament table). Felt like two different identities for the same person. Extracted both into `src/components/player-career-section.tsx` — server component owns all queries + rendering. Both pages mount it. Career numbers + per-tournament table are byte-identical between the two routes; only the headers differ (auth-specific bits like super-admin badge / email / joined date stay on /me; "linked to" stays on /players/[id]). Dropped ~460 lines of duplicated query + render code in the process. |
| 2026-05-16 | **Homepage redesign: champion hero on tournament pages, past-tournaments grid on the homepage** | Now that 6 historical seasons of data live on prod, the empty "No matches live" CTA was wasting the page. Homepage now always shows Live (if any) → personal profile strip (if signed-in + linked) → upcoming → recent → past-tournaments grid. Tournament pages gained a `TournamentChampion` hero on completed tournaments with champion crest + final scoreline + runner-up + Player-of-the-Tournament (POM count primary, total-runs tie-break across both balls + historical_match_batting). See §16. |
| 2026-05-16 | **New role: team admin** (per-team admin between tournament-organizer + scorer) | Captains / team managers need to be able to edit their team's logo + roster without elevating them to tournament-wide organizer. New `team_admins` table + `is_team_admin()` SECURITY DEFINER helper; existing `teams_write` + `tp_write` policies extended to include team admins. New `canManageTeam` / `requireTeamManager` auth helpers + `addTeamAdmin` / `removeTeamAdmin` server actions. Roster guard added (universally, not just for team admins): a player can be on at most one team per tournament — `addPlayerToTeam` now rejects the insert if the player is already on a sibling team in the same tournament. Migration `20260516060000_team_admins.sql`. UI: organizer-only "Team admins" card on `/tournaments/[slug]/teams/[teamId]`; team admins see the existing Edit / Add player / Remove buttons. |
| 2026-05-16 | **Captain + vice-captain → auto team admin; ≤1 of each per team** | Migration `20260516070000_team_roles_and_admin_sync.sql`. Partial unique indexes on `team_players (team_id) where role = 'captain'/'vice_captain'` cap each team at one captain + one vice-captain. New `team_admins.source` column ('manual' default, 'role' auto). AFTER INSERT/UPDATE/DELETE trigger `sync_team_admin_from_role` on `team_players`: when a player who is linked to a user gains the captain or vice-captain role, an auto-derived team_admins row is created (`source='role'`); demotion removes it. Manual team_admins rows are untouched by demotion. UI: amber banner on team page when captain or vice-captain missing; team-admins list shows "auto · captain / vc" vs "manual" tags; Remove button hidden for auto rows (organizer demotes via the squad role select instead). |

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
- [x] Authentication → Sign In / Up: Email provider enabled. Site URL = `http://localhost:3000`
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

### Phase 4 — Scoring engine ✅
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
- [x] **4d (part 3b) — Multi-ball undo**:
  - `voidLastN({ matchId, inningsId, count })` server action voids the N most recent non-voided balls in one round-trip. Trigger recomputes innings totals; `is_complete` is un-marked in case the original last ball had ended the innings.
  - Scoreboard adds two extra buttons next to "Undo last ball": **Undo last 3** (caps at total ball count) and **Undo this over** (count derived from `currentOverBalls.length`). Both confirm with `confirm()` and toast on error.
- [x] **4e — Defense-in-depth at the DB layer**:
  - 6 CHECK constraints on `balls` (range on `runs_off_bat` / `extras` / `ball_in_over`, wicket_type whitelist, `is_wicket → wicket_type` pairing, `legal_ball_seq` consistency with extra_type).
  - Trigger `trg_balls_free_hit` rejects free-hit dismissals outside `run_out / hit_wicket / obstructing` (standard-cricket baseline; HVC's stricter set stays in the engine).
  - Trigger `trg_balls_innings_open` rejects inserts into an innings that's already marked `is_complete`. Updates (voiding) still allowed so undo can re-open the innings.
  - Applied to live DB and synced into `db.sql`.
  - **Trade-off vs full Edge Function:** a Deno-side Edge Function that replays the engine would catch tournament-specific rule violations too, but requires routing every `recordBall` through it (service-role key + Server Action refactor + Deno compat for the engine). The trigger layer catches the worst categories of invalid data with zero architecture change and runs on every write path including bypasses. Deferred to a future "Phase 4e+" if we ever serve the API from outside Next.js.

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

### Phase 7 — Access-control hardening (2026-05-09) ✅
- [x] **Tightened player-registry writes.** RLS policies `players_insert_admin` and `players_update_admin` now require super-admin OR `tournament_admins.role = 'organizer'`. Removes scorer + roleless-auth-user write access to the registry.
- [x] **`players.linked_user_id` link** with partial unique index `ux_players_linked_user_id` — at most one player per auth user; multiple unlinked players still allowed.
- [x] **`lookup_email_by_user_id(uuid)` SECURITY DEFINER helper** added (authenticated only), symmetric to `lookup_user_id_by_email`.
- [x] **`isOrganizerOrSuperAdmin` / `requireOrganizerOrSuperAdmin`** helpers in `src/lib/auth.ts`.
- [x] **`createPlayer` / `updatePlayer` Server Actions** swapped from `requireUser` to `requireOrganizerOrSuperAdmin`. Both accept an optional `linked_email` that is resolved via the RPC and stored as `linked_user_id`. Friendly errors for unknown emails and unique-violations (a user already linked to another player record).
- [x] **UI gates updated**:
  - `/players` "New player" button hidden unless caller is org/super.
  - `/players/[id]` "Edit" button hidden unless caller is org/super; "Linked to: email" line surfaces the link when present (visible to any signed-in user, not anon).
  - `/players/new` and `/players/[id]/edit` page-level gates swapped to the new helper.
  - `/me` shows the user's linked player record (link to player page) when one exists.
- [x] Type stub updated with `lookup_email_by_user_id`. 21/21 engine tests still pass; `tsc --noEmit` clean.

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
  - **Points table** as a `Standings` section on `/tournaments/[slug]`. Sourced from the `v_points_table` view + a typed cast (view isn't in the Database stub yet). Columns: P / W / L / T / NR / Pts / **NRR**. Sorted by points → NRR → name. NRR is computed in the page from `innings` rows (innings 1/2 only; super-over innings excluded) using ICC-style full-quota overs when a team is bowled out.
  - **Full scorecard** on `/matches/[id]` when `status='completed'`: per-innings batting card (Batter / Out / R / B / 4s / 6s / SR with full dismissal text — `c X b Y`, `b Y`, `run out (Z)` etc.), extras row (wd / nb / b breakdown + total), bowling card (Bowler / O / R / W / Wd / Nb / Econ). Computed inline from `balls` rows; mirrors v_innings_batting + v_innings_bowling.
  - DNB ("did not bat") detection: any XI member who never appeared as batter or non-striker.
- [x] **Part 2 (continued)** — Public `/players/[playerId]` page:
  - Career-totals card (R / B / 4s / 6s / SR / Wickets / Overs / Econ) summed across every tournament the player has touched. Sourced from the `v_player_tournament_stats` view via a typed cast.
  - Per-tournament breakdown table linking back to each tournament page.
  - `/players` list rows now link to the detail page; the inline Edit affordance is on the detail page itself for signed-in admins.
- [x] **Part 2 (continued, OG)** — Dynamic Open Graph images via Next 16's `opengraph-image.tsx` convention:
  - `/matches/[id]/opengraph-image` renders a 1200×630 with team short names, both innings scorelines (when present), tournament + stage line, and a status pill (LIVE / FINAL / scheduled date). `revalidate = 60` so live shares stay fresh.
  - `/tournaments/[slug]/opengraph-image` renders tournament name, short description, dates, venue. `revalidate = 300`.
  - Endpoints verified to return 200 with `image/png` content-type.

### Phase 6 — Polish & engagement (incremental)
- [x] **PWA install** — `app/manifest.ts` + dynamic icons (`icon.tsx` 32×32, `icon1.tsx` 192×192 maskable, `icon2.tsx` 512×512 maskable, `apple-icon.tsx` 180×180). All rendered via `next/og` ImageResponse — no static asset files. `display: standalone`, dark theme. Verified manifest + each icon endpoint returns the correct content-type.
- Open Graph images for matches + tournaments — done in Phase 5 part 2.
- Points table — done in Phase 5 part 2.
- Player career stats page — done in Phase 5 part 2.
- [x] **Service worker + IndexedDB durable queue for offline scoring** — `public/sw.js` is a hand-rolled SW (no Workbox) registered from `src/components/register-sw.tsx` (production-only — Turbopack HMR doesn't play well with a SW intercepting requests in dev). Strategy: network-first for HTML navigations with cache fallback; stale-while-revalidate for hashed JS / CSS / image assets; cross-origin (Supabase) and Server Action / RSC payloads pass through untouched so writes always go straight to network. Cache versioned via `CACHE = "hvc-scoring-v1"` and old caches dropped on `activate`. The scoreboard now persists every `recordBall` / `voidLastBall` / `voidLastN` to IndexedDB (`src/lib/offline-queue.ts`, backed by `idb`) **before** any network attempt — so the queue survives page reloads, tab close, and offline gaps of any length. The drain loop runs serially: success or server-validation rejection drops the task; a network throw pauses the loop and resumes on the `online` event (with a 15s safety tick as backup). Two pills surface state in the Record-ball card title: red "Offline · queuing" when `navigator.onLine === false` or the last drain hit a network error, yellow "Saving N ball(s)…" while the queue is non-empty.
- [x] **Commentary feed (auto) — 2026-05-13** — `src/lib/commentary.ts` maps each ball to a deterministic one-line description (`"FOUR! Pavan finds the boundary off Sandy."`, `"WICKET! Ambrisha bowled by Virat."`, `"No-ball, SIX! Pavan sends it sailing — 6 + 1 extra."` etc). `src/app/matches/[matchId]/commentary-feed.tsx` is a server component that fetches balls + player names + team short_names, groups by innings (latest innings first), renders balls in reverse chronological order (latest at top). Free-hit balls get a yellow `over` pill; wickets are red + bold; boundaries are bold. Mounted on `/matches/[id]` between `MatchCharts` and `FullScorecard`, visible for live / innings_break / completed states. Auto-refreshes alongside everything else (force-dynamic + AutoRefresh). Manual scorer notes per ball deferred — the `balls.commentary` column exists but no UI to write to it yet.
- [x] **Audit-log UI — 2026-05-13** — admin-gated page at `/matches/[matchId]/activity` (`page.tsx`). Pure derived view: each `balls` row produces a "Recorded" event keyed off `scored_by` / `scored_at`; voided rows produce a second "Voided" event from `voided_by` / `voided_at`. Joins `profiles.display_name` for the scorer column (falls back to first 8 chars of the user UUID if the profile is unreadable). Renders a table: When · Event · Innings · Over · Ball · Scorer. Voided rows get a destructive-tinted row + strike-through on the ball description. Sorted latest-first. `requireTournamentAdmin` gates access. Linked from the match page's admin-only action group as "Activity".
- [x] **Match-level audit events — 2026-05-13** — sibling to the per-ball log. Migration `20260513020000_match_audit_events.sql` adds a generic `match_audit_events` table (match_id, event_type, actor_id, payload jsonb, created_at) with RLS denying all. `src/lib/match-audit.ts` exposes `logMatchAuditEvent` (writes via service role, best-effort — never throws back to the caller) and `listMatchAuditEvents` (reads via service role). Event types currently emitted: `toss_set` (from `tournaments/[slug]/matches/actions.ts#setToss`), `xi_changed` (from `matches/[matchId]/xi/[teamId]/actions.ts#savePlayingXI`), `match_started` / `innings_2_started` / `super_over_started` (from the three startXxx actions in `score/actions.ts`), `match_completed` (from `finalizeMatchInternal`), `potm_set` / `potm_cleared` (from `player-of-match/actions.ts#setPlayerOfMatch`). The activity page merges these match-events with the ball-events in one chronological stream; match-events get a blue-tinted row + `Match start` / `Toss` / `POTM set` etc. badge.
- [x] **Manhattan + worm charts** — `src/app/matches/[matchId]/match-charts.tsx` is a server component mounted on `/matches/[id]` for live / innings_break / completed states. Hand-rolled SVG (no charting library). **Manhattan**: one panel per innings — bars are runs-per-over with the per-over total above each bar; red dots above the bar mark wickets in that over. **Worm**: cumulative runs per delivery, one line per innings (innings 1 blue / 2 orange / SO purple / SO emerald), plus a dashed orange target line at innings 1 + 1 for the chase. Both charts share `force-dynamic` rendering with the rest of the page so AutoRefresh's `router.refresh()` keeps them live without an extra fetch path. Wagon wheel deferred — needs admin shot-zone capture in the scoring page (separate UX work).
- [x] **Web push notifications (per-match opt-in)** — `push_subscriptions` table (FK to `matches` with `on delete cascade`; unique `(match_id, endpoint)`; RLS denies all so only the service role touches it). Spectators tap the bell on `/matches/[id]` → `NotifyButton` (`src/app/matches/[matchId]/notify/notify-button.tsx`) calls `Notification.requestPermission()` → `pushManager.subscribe()` → `subscribePush` Server Action upserts the record using a service-role admin client (`src/lib/supabase/admin.ts`). The SW (`public/sw.js`) handles `push` (showNotification with title / body / icon / badge / tag-based dedupe) + `notificationclick` (focus-existing-tab-or-open-window). Server-side dispatch (`src/lib/push.ts`) uses `web-push` with VAPID; reads subs via service role and prunes 404 / 410 endpoints. `recordBall` detects four trigger events (wicket, batter-50, batter-100, innings-break, match-end — milestones compare striker's pre-ball runs vs post-ball runs) and dispatches via `next/server` `after()` so ball entry returns immediately. **Env vars needed:** `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — generated keypair lives only in the user's `.env.local` / Vercel env. Migration file: `supabase/migrations/20260510000000_push_subscriptions.sql`.
- [x] **Optimistic UI on the scoring page (2026-05-11)** — taps land on-screen the instant they're made; the server roundtrip only confirms what's already shown. `OptimisticBall` queue is pushed synchronously on each `submit()`; the headline `displayRuns / displayWickets / displayOvers` add the queue's contribution on top of `innings.total_runs / wickets / legal_balls`. Mirror `PendingUndo` queue subtracts server balls flagged for undo so taps on Undo / Undo last 3 / Undo this over update the score the instant they're pressed. Reconciliation effect (`serverBallsRef`) shifts the queues when `state.balls.length` changes — advances shift optimistic, regressions shift pendingUndos. Validation rejections drop the matching entry; network failures leave them in place so the score stays consistent until reconnect. Optimistic pills render at 60% opacity + italic in the recent-balls strip; pending-undo balls disappear from the strip entirely.
- [x] **Wide / no-ball pill labels (2026-05-11)** — fixed a display bug where the recent-balls strip was double-counting the wide / no-ball penalty (plain Wide showed `2wd` instead of `1wd`). `extras` already includes the penalty; the formula is now `${b.extras}wd` for wides and `${b.runs_off_bat + b.extras}nb` for no-balls. Innings totals and DB rows were never affected.
- [x] **Scorecard parity pass (2026-05-11)** — closes the most visible gaps vs CricHeroes / Cricbuzz / ESPNcricinfo. Pure derived UI on top of existing data, no schema changes.
   - **Fall of wickets** line per innings in `FullScorecard`: `1-4 (Pavan, 0.3), 2-15 (Ambrisha, 2.5), …`. Cricket-convention `over.ball` notation (`over_number - 1` because the DB is 1-based).
   - **Partnerships table** per innings: wicket number, both batters, runs, balls. Walks ball-by-ball comparing the (batter, non-striker) pair to detect changes — pair change = wicket, close current partnership, start fresh.
   - **Did-not-bat row** in `FullScorecard` — moved out of the batting table into a footer line for XI members who never came in.
   - **Bowler dots + maidens** columns in the full bowling table; the live `BowlerRow` swaps Wd for M + Dots (denser, scorecard-feel).
   - **Current partnership pill** on `LiveScorePanel`: `Partnership: 27 (15)` (runs since the last wicket fell).
   - **Last-N-overs RR** line on `LiveScorePanel`: `Last 5 ov: 42 runs · RR 8.40` (visible once 2+ overs have been bowled; window auto-shrinks for short innings).
   - **Free-hit ring** on recent-balls pills — `balls.is_free_hit` was stored but invisible; now shows a yellow ring around the pill on both the live panel and the scoring page.
- [x] **Player of the match — auto with admin override (2026-05-11)** — uses the existing `matches.player_of_match_id` column. `MatchAwards` server component (`src/app/matches/[matchId]/player-of-match/match-awards.tsx`) computes a points score for every XI member from `balls` + winner team; top scorer renders as the "Auto-pick" if `player_of_match_id` is null, otherwise the admin-picked player shows. Admin form (`player-of-match-form.tsx`) shows the top 3 candidates as one-click chips with their stat line + total points, plus a full alphabetical dropdown to override. "Use auto-pick" button clears the column. **Formula documented in `docs/POTM-FORMULA.md`** — change a literal in the function to tune any threshold; no schema, no migration.
- [x] **Per-over Category control + Cat 1/3 first-over rule (2026-05-12)** — adds a scoreboard-level `Category` dropdown (Cat 1 / Cat 2 / Cat 3) that defaults from the over number (1 → Cat 1; 2 → Cat 2; 3+ → Cat 3), re-applies on every over boundary while preserving scorer overrides mid-over, and gates the striker + bowler `SlotPicker`s. `submit()` aborts with a toast if the slots don't match the selected restriction. Cat 2 = open. At innings 1 + 2 start the same Cat 1-striker-must-face-Cat 1-bowler rule is enforced via `enforceCat1FirstOverRule` helper in `actions.ts` (called from `startMatch` and `startSecondInnings`) plus a client-side check in `start-match-panel.tsx` / `innings-break-panel.tsx`. Super overs (innings 3/4) exempt from the start-of-innings check; the dropdown's per-over logic still applies. Engine's `computeSpecialOverContext` rewritten to derive from `striker.category` alone (drops the `over_number === cat1_over` / `cat3_over` gate); `special_over` is reset to `null` inside `applyBall` at the end-of-over swap so a dismissed special batter swapped to the non-striker slot is correctly blanked from the next over's lineup. State loader's wicket-blanking is now state-based (`engine.dismissed`) with a `cat_special_strike = "stay"` exception — a dismissed Cat 1 batter holds their slot for the rest of the over, then is barred from re-batting via `dismissed_ids` in the picker. 21/21 engine tests still pass.
- [x] **Wicket-on-no-ball / wide / bye (2026-05-12)** — `WicketButton` modal in `scoreboard.tsx` grew a `Delivery` select (Legal default / No-ball +1 penalty / Wide +1 penalty / Bye +1). `onSubmit` signature extended to pass the delivery type; caller maps it into the `recordBall` payload as `extra_type` + `extras = 1`. The previous flow (wicket on a legal ball) is unchanged. Free-hit dismissal restriction (`run_out` / `hit_wicket` only) still applies via the existing `onFreeHit` filter.
- [x] **`balls_ball_in_over_range` relaxed to `0..6` (2026-05-12)** — engine semantic for `ball_in_over` is "legal balls completed in the over so far" (= 0 at start). A wide / no-ball as the first delivery of an innings or over is correctly recorded with `ball_in_over = 0`; the old `1..6` constraint rejected it. Migration: `supabase/migrations/20260512000000_balls_in_over_allow_zero.sql`. `db.sql` updated.
- [x] **Engine slot sync during replay (2026-05-12)** — `applyBall` only rotates `striker_id` / `non_striker_id` via cricket rules; it doesn't accept new IDs from `BallInput`. So scorer-driven mid-innings substitutions (e.g. picking a new non-striker after a run-out) were getting overwritten by the engine's stale view on the next revalidation. `state.ts` (loader replay) and `actions.ts` (validator replay loop + pre-validation block) now call `setStriker` / `setNonStriker` before each `applyBall` so engine slots track the recorded ball rows. Pre-validation in `recordBall` also syncs from the new ball's input so the engine validates against the scorer's chosen striker/non-striker for this delivery.
- [x] **Nav heading copy (2026-05-12)** — `"HVC Scoring"` → `"HVC Tournament Scoring"` in `src/components/site-nav.tsx`. Other surfaces (page title, manifest, OG images, login card description) intentionally left as-is.
- [x] **Mobile header (2026-05-13)** — `Tournaments` / `Players` nav links were `hidden sm:flex` so phones saw none. `site-nav.tsx` now: shows both links at every breakpoint with smaller gaps on mobile; collapses the long brand to `"HVC Scoring"` (full name on `sm:` and up); replaces the user-name link with an avatar initial circle on mobile. Tap area `/me` is preserved.
- [x] **Wicket-on-extra pill label (2026-05-13)** — the recent-balls strip rendered just `W` for a wicket on a wide / no-ball / bye, hiding the delivery type. `renderBall` in both `live-score-panel.tsx` and `scoreboard.tsx` now computes the extras suffix first and combines: `1wd+W`, `1nb+W`, `5nb+W` (NB+4 → wicket), `1b+W`. Legal wickets unchanged. Destructive red background still applies to every wicket pill regardless of delivery type.
- [x] **Refactor pass — shared scoring helpers + engine replay (Tier 1+2, 2026-05-13)** — pure dedup, no behavioural change.
   - `src/lib/supabase/row-types.ts` — `BallRow` / `MatchRow` / `InningsRow` / `PlayerRow` / `MatchPlayerRow` aliases (was inlined as `Database["public"]["Tables"][N]["Row"]` across 4 files).
   - `src/lib/scoring/stats.ts` — `computeBatterStats` / `computeBowlerStats` (generic on `Pick<>` types so they accept BallRow OR the optimistic queue's shape) + `BOWLER_CREDIT_WICKETS` constant. Replaces four near-identical copies in `live-score-panel.tsx`, `full-scorecard.tsx`, `scoreboard.tsx`, `match-awards.tsx`.
   - `src/lib/scoring/replay.ts` — `createEnginePlayerFactory` + `replayInnings` helper (was duplicated ~80 lines each in `state.ts` and `actions.ts`'s prevBalls replay). Replay loop syncs `setStriker` / `setNonStriker` / `advanceBowler` from each ball row before `applyBall` so the engine's slots / per-bowler counts stay accurate across mid-innings substitutions.
- [x] **Refactor pass — split `scoreboard.tsx` + `actions.ts` (Tier 3, 2026-05-13)** — three new sibling files in `src/app/matches/[matchId]/score/`:
   - `wicket-button.tsx` — the wicket modal (188 lines) extracted with its own state. Exports `WicketButton`, `WicketType`, `WicketDelivery`.
   - `record-ball-helpers.ts` — `validateBowlerRules` (no consecutive overs, no mid-over swaps, single-2-over-bowler) and `computeBallPosition` (`over_number` / `ball_in_over` / `legal_ball_seq` / `isLegal`) as pure functions. Called from `recordBall`; trivial to test in isolation.
   - `use-offline-queue.ts` — the IDB drain loop + online/offline events + heartbeat tick + bootstrap, as a reusable React hook. Takes `runTask` and `onTaskComplete` callbacks so scoring-specific logic (optimistic queue cleanup on validation rejection) stays in the scoreboard. `scoreboard.tsx` 1286 → 966; `actions.ts` 1131 → 1012.
- [x] **Default over Category remap + Cat 1/3 repeat-dismissal rule (2026-05-13)** — `defaultOverCategory(overNumber)` now maps over 1 → Cat 1, over 2 → Cat 3, over 3+ → Cat 2 (HVC's actual order, was previously over 2 → Cat 2 / over 3+ → Cat 3). And the Cat 1/3 special-batter rule was tightened: repeat dismissals of the special batter inside their special over **still credit the bowler each time** (per-ball stats unchanged) but **don't add to the team's innings wicket total** beyond the first. New column `balls.counts_for_innings_total boolean not null default true`; `recordBall` checks pre-`applyBall` engine state (`special_over !== null && special_batter_dismissed === true && dismissedId === special_batter_id`) and inserts the row with the flag set to false on repeats. `recompute_innings` SQL function filters `total_wickets` on the column. Migration `supabase/migrations/20260513000000_balls_counts_for_innings_total.sql`; `db.sql` updated.
- [x] **Wicket modal: Runs picker + "Runs are byes" toggle (2026-05-13)** — wicket modal grew a `Runs` row with five buttons (0 / 1 / 2 / 3 / 4) so wickets accompanied by bat runs / wide-extras / byes record as one ball. When `Delivery = No-ball` an extra checkbox **"Runs are byes (not off the bat)"** appears — toggling it routes the chosen N into `extras` (alongside the 1-run penalty) instead of `runs_off_bat`. Solves the no-ball-byes-run-out case where the striker isn't credited for runs the batsmen actually ran as byes. The "Runs" hint label updates dynamically (off the bat / off the bat (penalty added) / byes (not off the bat) / additional wides / byes). `WicketButton#onSubmit` signature now takes `(wicket_type, player_out_id, fielder_id, delivery, runs, no_ball_byes)`; caller in `scoreboard.tsx` splits into `runs_off_bat` vs `extras` per delivery convention.
- [x] **Single Wide/No-ball/Bye/Overthrow buttons with inline pickers (2026-05-13)** — replaced ~17 individual buttons (Wide ×4, NB ×5, Bye ×4, the short-lived NB-Bye ×4) with a single row of 3-4 buttons in the main scoring panel. Each opens an inline 0–6 sub-picker on tap and closes after a number is tapped. **No-ball picker** carries the same "Runs are byes" toggle as the wicket modal so the same delivery shape can be recorded without entering the wicket flow. **Bye** picker covers 0–6 byes. **Overthrow** is a new button with a 1–7 picker (runs all credit the batter — covers the 5 / 7-run cases the main 0/1/2/3/4/6 row doesn't expose, e.g. boundary 4 + 1 overthrow). Active button gets a `default` variant fill while its picker is open. State: `extraPicker: "wide" | "no_ball" | "bye" | "overthrow" | null` + `noBallByesPick: boolean`.
- [x] **Engine: strike rotation on non-legal odd-run deliveries (2026-05-13)** — `applyBall` previously gated rotation on `isOddRun && isLegalBall`, so `NB +1` / `NB +3` didn't swap strike (they should — the batsmen running an odd number of times rotates regardless of the delivery being a no-ball). Now computes `rotationRuns = runs_off_bat + (isBye ? extras : 0) + ((isNoBall || isWide) ? max(0, extras - 1) : 0)` — the 1-run penalty for wides / no-balls doesn't count, but the running runs do. Swaps on `rotationRuns % 2 === 1`. Cat 1 / Cat 3 special-batter "stay" override unchanged. Overthrow 5, NB+1, NB+3, Wide+1, B 1 all rotate correctly now.
- [x] **Mobile slot tile layout (2026-05-13)** — slot grid was `sm:grid-cols-3` so on phones the three tiles stacked vertically. Now `grid-cols-2 sm:grid-cols-3` with the Bowler wrapper using `col-span-2 sm:col-span-1`. Phone shows **Striker + Non-striker on row 1, Bowler on row 2** (full-width). Tablet+ unchanged. Reduces vertical scroll on the most-used scoring screen.
- [x] **Recent-balls relocation (2026-05-13)** — top-of-screen RecentBalls card removed. `renderBallPill` + `BallStrip` hoisted to module scope. `SlotPicker` gained an optional `footer` prop that renders below the stats line behind a divider; the Bowler tile uses it to surface the current-over pill strip *inside* the box (tapping the strip still opens the bowler picker — acceptable trade-off for visual integration). A separate small **Previous over** panel renders at the very bottom of the page, only when there's a previous over to show. The old `RecentBalls` Card component was deleted from `scoreboard.tsx` (left untouched in `live-score-panel.tsx` for the spectator view).
- [x] **Hide global site nav on mobile when on the score route (2026-05-13)** — `src/components/site-nav-shell.tsx` is a client wrapper that reads `usePathname()` and stamps `hidden sm:block` on a wrapping div when the path matches `^/matches/[^/]+/score(\/|$)`. Frees the entire phone viewport for scoring without affecting tablet/desktop or other routes. `src/app/layout.tsx` updated to wrap `<SiteNav />` with `<SiteNavShell>`.
- [x] **"Record ball" card header dropped (2026-05-13)** — the wrapping Card's CardHeader is now only rendered when a status pill needs to show ("Offline · queuing" or "Saving N ball(s)…"). Idle state has no header — straight to the big run buttons. Saves a vertical row on phones where every pixel of scoring real estate matters.
- [x] **Previous-over bowler disabled in the bowler picker (2026-05-13)** — `validateBowlerRules` already rejected back-to-back overs server-side but the message only fired AFTER the scorer picked a bowler and tapped a run. The bowler `SlotPicker`'s `disabledIds` now also includes the just-finished over's bowler at over boundaries (innings 1 + 2 only; super overs unaffected). State loader nulls `state.active.bowler_id` at the boundary, so the client detects "we're between overs" without an extra prop.
- [x] **Last-man-standing rule (2026-05-13)** — HVC convention: when 6 of 7 batters are out the lone surviving batter keeps batting until they're also dismissed (innings doesn't end at `players_per_side - 1`). New `RuleSet.last_man_standing` flag (HVC: true, standard: false) wires through:
   - `engine.ts` — `lastManMode = rules.last_man_standing && !is_super_over && dismissed.size >= players_per_side - 1`. When true: strike rotation on odd runs is disabled, end-of-over swap is skipped, `wicketsCap = players_per_side`.
   - `state.ts` — `state.active.last_man_mode` exposed to the client; loader keeps a dismissed non-striker in their slot (so the dummy stays visible across the rest of the innings instead of getting blanked by the standard `isDismissed` check).
   - `scoreboard.tsx` — non-striker `SlotPicker` is locked when last-man mode is active (every option except the current value lands in `disabledIds`, so the dropdown can't change). New orange uppercase **"Last man standing"** pill in the top scoreboard card.
   - Zod schema (`parse.ts`) defaults `last_man_standing` to false for backward-compat with older `tournaments.rules` JSONB rows that pre-date the flag.
   - 21/21 engine tests still pass.
- [x] **Manual swap button on the scoreboard (2026-05-13)** — `⇄ Swap` button at the right end of the Category row swaps local `strikerId` ↔ `nonStrikerId` so the next recorded ball uses the new arrangement (engine syncs via existing `setStriker` / `setNonStriker` replay calls). Used when the engine's automatic rotation doesn't match what happened on the field. Disabled when both slots are empty or in last-man mode. Icon-only on phones, icon + "Swap" label on tablet+. Uses lucide-react's `ArrowLeftRight`.
- [x] **`pnpm-workspace.yaml` fix (2026-05-13)** — `onlyBuiltDependencies: '["supabase"]'` (malformed YAML string) was being parsed as opaque text, so pnpm kept ignoring `supabase`'s postinstall script and never downloaded the platform-specific binary into `node_modules`. Converted to a proper YAML list. Stops the "Failed to create bin" warnings on `pnpm install`.
- [x] **Last-man-standing UX polish (2026-05-14)** — follow-up tweaks after live testing the 2026-05-13 implementation.
   - **Auto-pick striker:** `state.ts` looks up the batting-XI member not in `engine.dismissed` and not in `engine.barred_batters` and fills `state.active.striker_id` with them whenever the slot would otherwise be null or pointing to a dismissed player. So the moment last-man mode kicks in, the live batter shows up at the striker end automatically.
   - **Force non-striker empty when it would conflict:** loader clears `non_striker_id` when it points to a *non-dismissed* player — that can only be the lone live batter (= same as the new striker), so leaving them as non-striker would put the same person at both ends. Once the scorer picks a dismissed dummy, the loader sees a dismissed `non_striker_id` and preserves it across subsequent balls.
   - **Non-striker picker relaxed:** in last-man mode the `SlotPicker`'s `disabledIds` is just `[strikerId]` (was: every option except the current). Any dismissed batter is selectable as the dummy, and `dismissedIds` still surfaces the "(out)" suffix so the scorer can tell who's who.
- [x] **Wicket modal: Player out defaults from wicket type (2026-05-14)** — Player out used to always default to "Striker", which silently mis-recorded run-outs of the non-striker if the scorer didn't notice the dropdown. Now: `useEffect` on `wicketType` resets Player out to "striker" for every type except `run_out`, which clears the field and shows a "Select…" placeholder. Save wicket is blocked with a toast (`"Pick who's out — striker or non-striker"`) when empty. `close()` resets the modal completely (Type back to bowled, Player out back to striker, etc.) so the next open starts clean.
- [x] **Scoreboard slot-tile polish: icons + cyan striker + inline bowler stats (2026-05-15)** — role identification now leans on icon + colour instead of a text label.
   - **Bat icon** before each batter (small inline SVG, handle + blade). `text-cyan-600 dark:text-cyan-400` for the striker, `text-muted-foreground/40` for the non-striker — the visual "on strike vs not on strike" cue.
   - **Striker name** uses the same cyan shade so the pair is unmistakable; non-striker name stays default foreground.
   - **"Striker" / "Non-striker" / "Bowler" labels** removed from the slot tiles — the icons + colour + tile position carry the role.
   - **Ball icon** (circle + faint seam SVG) before the bowler name.
   - **Bowler stats inlined** on the same row as the name, right-aligned via `ml-auto` — `[ball] Player ▾   0/4 (0.3) · econ 12.0`. The this-over pill strip (footer) still renders below.
   - **`formatBatterStats`** dropped the `1×4 6×6` boundary count — too granular for the live tile; full scorecard still shows boundaries.
   - `SlotPicker` gained two props: `leadingIcon` (renders before the name) and `inlineStats` (puts the stats line on the name row instead of below).
- [x] **Multi-scorer lock with permission-based takeover (2026-05-13)** — only one tournament admin records balls on a given match at a time. Two columns added to `matches` (`primary_scorer_id` + `primary_scorer_heartbeat_at`, migration `20260513000000_match_scoring_lock.sql`) and a takeover-request slot (`pending_scorer_request_id` + `pending_scorer_request_at`, migration `20260513010000_match_scoring_takeover_request.sql`).
   - Server actions in `src/app/matches/[matchId]/score/lock-actions.ts`: `getScoringLockStatus`, `acquireScoringLock` (claims free / mine / expired), `heartbeatScoringLock`, `releaseScoringLock`, `requestScoringTakeover`, `approveScoringTakeover`, `denyScoringTakeover`, `cancelScoringTakeoverRequest`, and an internal `enforceScoringLock` helper called by `recordBall` / `voidLastBall` / `voidLastN`. The shared `LockStatus` union + `LOCK_EXPIRY_SECONDS` constant live in `lock-types.ts` because `"use server"` files can only export async functions.
   - Client `ScoringLockGate` (`scoring-lock-gate.tsx`) wraps the Scoreboard. On mount it tries to acquire; if successful renders children and heartbeats every 30 s (server expiry = 120 s, 4× the tick). If another admin already holds the lock the gate renders one of four read-only states (default held / my-request-pending / other-request-pending / expired) and routes the takeover through the new permission flow. When I hold the lock and someone has filed a request, a yellow sticky banner appears above the Scoreboard with Allow / Deny / Refresh buttons; scoring stays unblocked while I decide. On unmount → best-effort `releaseScoringLock`; the 120 s expiry catches closed-tab cases.
   - Defense in depth: `recordBall` / `voidLastBall` / `voidLastN` each call `enforceScoringLock` before doing any work and reject with `"Another scorer is recording this match. Request a takeover from the banner."` if the caller doesn't hold an active lock. Successful writes bump the heartbeat for free, so active scorers never time out mid-match.
- [x] **Scoring-page UX + correctness overhaul (2026-05-11 evening)** — driven by live testing. Lots of small fixes that together make the scoring screen ready for real matches at HVC pace.
   - **Merged the slot tiles into the top card.** The duplicate "Who's batting / bowling?" card is gone; each slot tile is now a styled `<select>` (native mobile picker on tap). Run buttons grew to `h-20 text-3xl` with press-down feedback. The whole scoring surface fits one mobile screen — no scroll to reach the run buttons.
   - **Persist the initial picks on the innings row.** Schema migration `supabase/migrations/20260511000000_innings_initial_players.sql` adds `initial_striker_id` / `initial_non_striker_id` / `initial_bowler_id` (nullable FK to `players` with `on delete set null`). `startMatch` / `startSecondInnings` / `startSuperOverInnings` write the picks alongside batting/bowling team IDs; state loader falls back to them when no balls have been recorded yet so the scorer doesn't re-pick after Start.
   - **Engine replay in `state.ts`.** `loadScoreboardState` now seeds `startInnings` with the initial picks (or `balls[0]` as fallback) and runs `applyBall` over every recorded ball. `state.active.striker_id` and `non_striker_id` come from engine state, so post-rotation strikers (after a single, end of over, etc.) are correct — was previously copying `last.batter_id` straight through and never applying rotation.
   - **Bowler tracking uses `last.bowler_id`, not the engine.** `applyBall` doesn't take a bowler input, so the engine's `bowler_id` stays glued to whoever seeded `startInnings`. Trusting it for the slot tile silently flipped the bowler back to the initial pick on every revalidation. `state.active.bowler_id` now comes from `last.bowler_id` (or `null` at over boundaries to force a fresh pick).
   - **`advanceBowler` during replay** in both `state.ts` and `recordBall`. When a recorded ball's bowler differs from engine `state.bowler_id`, sync via `advanceBowler` before the next `applyBall` — otherwise the engine's per-bowler `bowler_legal_balls` map all piles onto the initial bowler and fires `bowler_at_max` against the wrong person.
   - **HVC bowler rules enforced in `recordBall`** (innings 1 + 2 only):
      - Same bowler can't bowl two overs back-to-back (checked when the previous ball was the 6th legal).
      - Same bowler can't change mid-over (checked when the previous ball didn't end an over).
      - HVC convention: at most ONE bowler in the innings may bowl 2 overs; everyone else is capped at 1. Detected from `prevBalls` per-bowler legal-ball counts — if the new bowler is about to bowl their 7th legal ball AND some other bowler already has >6 legal balls, reject. Engine's `max_overs_per_bowler` (= 2) still serves as the hard cap.
   - **State loader nulls slots that need re-pick.** `state.active.bowler_id = null` at an over boundary; striker/non-striker is nulled if `last.is_wicket && player_out_id` matches. The slot tile reads `—` and the next-tap toast names exactly what's missing ("Pick the bowler first", "Pick the striker first", etc.).
   - **Slot pickers grey out invalid options.** `state.active.dismissed_ids` (from engine replay's `dismissed` set) is passed to each batter `SlotPicker`. Striker dropdown disables already-dismissed players (with "(out)" suffix) + the current non-striker; non-striker dropdown disables dismissed + the current striker. Bowler picker untouched (dismissed batters are on the batting team).
   - **Per-player stats line is optimistic too.** `OptimisticBall` now carries `striker_id` / `non_striker_id` / `bowler_id` / `player_out_id`. `formatBatterStats` / `formatBowlerStats` fold the optimistic queue in alongside server balls, so `pavan 6(4) → 7(5)` updates the instant the scorer taps. Was lagging behind the headline by 500 ms – 2 s.
   - **Recent-balls pill labels** — `${b.extras}wd` for wides (was double-counting the penalty), `${b.runs_off_bat + b.extras}nb` for no-balls.
   - **Overs counter labelled** `1.0 / 7 ov` (was `1.0 / 7` — read as a fraction).
   - **Wicket form is a modal** (`src/app/matches/[matchId]/score/scoreboard.tsx#WicketButton`) — bottom-sheet on phones, centred dialog on tablet/desktop. Backdrop click + Escape + × all close. Body scroll locked while open. Replaced the inline expansion that previously required scrolling to reach Save. Caught & bowled now hides the fielder picker entirely (bowler is implicit; POTM credits the catch).
- [x] **Image upload** — `LogoUploader` client component (`src/components/logo-uploader.tsx`) does the file → Supabase Storage upload from the browser using the anon key. Storage RLS: public read on `tournament-logos / team-logos / player-photos / match-banners`; authenticated insert / update / delete (entity-level RLS still gates URL-saving). Wired into the three edit forms (tournament / team / player). Logos render on tournament list cards + tournament detail header, team grid cards + team detail header, player rows + player detail header, and inline next to short_names in the match list. 2 MB cap; image MIME type required.
- [x] **shadcn AlertDialog for destructive confirms** — `src/components/ui/alert-dialog.tsx` (radix-based, base-nova-styled) + `src/components/confirm-button.tsx` reusable wrapper that takes a title / description / confirmLabel / destructive flag and only fires `onConfirm` after the user clicks the action. All 6 native `window.confirm` call sites migrated: delete tournament / team / player / match, "Undo last 3" + "Undo this over" multi-undo, and remove tournament admin. Zero residual `window.confirm` in app code.
- [x] **Playoff bracket auto-scheduling (2026-05-17)** — when `tournaments.format = 'round_robin_playoff_final'`, finalizing each stage queues the next one automatically. Implementation lives in `src/app/matches/[matchId]/score/actions.ts` (`maybeAutoSchedulePlayoffs`), called from `finalizeMatch` after `finalizeMatchInternal` returns ok.
   - **All group matches terminal → Qualifier 1.** Top 2 teams on the points table (Pts desc → NRR desc) become `team_a` / `team_b`. Standings logic was extracted into `src/lib/standings.ts` (`computeStandings`) so the scheduler and `points-table-section.tsx` share one implementation; v_points_table for points, an `innings`-joined query for NRR (with ICC-style "full-quota overs if bowled out" override).
   - **Q1 terminal → Eliminator.** #3 vs #4 from the same standings.
   - **Eliminator terminal → Qualifier 2.** Q1 loser (= whichever of Q1.team_a/b isn't `winner_id`) vs Eliminator winner.
   - **Q2 terminal → Final.** Q1 winner vs Q2 winner.
   - **Inheritance + idempotency.** Every auto-scheduled match inherits `overs_per_innings` / `players_per_side` / `venue` from a group match (falls back to an earlier playoff match if no group exists). `match_number` is `MAX(match_number) + 1`. Each transition checks `!stageMatchExists` so re-runs are no-ops; the chain self-resumes if a prior call failed. Wrapped in `try/catch` so any failure logs to `console.error` and never blocks the scorer from finalizing the result. Revalidates the tournament page on success so the new fixture shows up immediately.
- [x] **Tournament status stays Live through playoffs (2026-05-17)** — `deriveTournamentStatus` (`src/lib/constants/tournament.ts`) signature changed from `(stored, matchStatuses[])` to `(stored, matches[{stage, status}], format)`. For formats whose `stagesForFormat(format)` includes `"final"` (knockout / group_then_knockout / round_robin_playoff_final), if every match is terminal but no `stage='final'` match is terminal yet, the badge stays **active** instead of flipping to **completed** — so a tournament that just wrapped the group stage doesn't read as "Completed" while the playoff bracket is still being scheduled. `league` format unchanged. Both callers updated: `src/app/tournaments/[slug]/page.tsx` (already had stage in its select) and `src/app/tournaments/page.tsx` (added `stage` to the bulk match-summaries select). Format-aware status sort order is unchanged (active → draft → completed → archived).
- [x] **Confirm before Swap (2026-05-17)** — the manual `⇄ Swap` button in the scoreboard's Category row now uses `ConfirmButton` with a `"Swap striker and non-striker?"` AlertDialog. The description names both players (`"X moves to non-striker; Y comes on strike."`) so the scorer can sanity-check the swap before committing. Disabled / aria-label / title behaviour unchanged. Stops accidental taps from silently reordering the crease.
- [x] **Innings-1 pending-finalize gate (2026-05-17 late)** — mirrors the existing match-complete confirmation flow but for innings 1. Previously the moment innings 1 auto-completed (all out / overs exhausted) the page flipped straight into the innings-2 picker, giving the scorer no chance to undo the decisive ball from a panel without a button. Now `recordBall` distinguishes by innings number: for innings 1 it stamps `is_complete = true` but leaves `ended_at = null`; for innings 2 / super-over it stamps both as before (those gate on `match.status` via `MatchCompletePanel`). New phase `innings_1_pending_finish` (`state.ts:derivePhase`) fires while `i1.is_complete && !i1.ended_at && !i2`. New `InningsFinishPanel` (`src/app/matches/[matchId]/score/innings-finish-panel.tsx`) renders the 1st-innings final score in the same Trophy-header / muted-card style as MatchCompletePanel, with **Finish innings** + **Undo last ball** buttons. New `finalizeInnings` server action (`actions.ts`) sets `ended_at = now()` on confirm (idempotent — re-running on an already-finalized innings returns ok). `voidLastBall` already clears both `is_complete` and `ended_at`, so undo from the pending panel re-opens innings 1 cleanly. Existing in-flight matches unaffected (in-progress innings have `is_complete = false`); matches past innings 1 already have `ended_at` set so they skip the new gate.
- [x] **Auto-pick Cat-matching striker + bowler on category change (2026-05-17 late)** — when the Category dropdown switches to **Cat 1** or **Cat 3** (manual change OR the over-boundary default reset via `defaultOverCategory`), the slot tiles auto-fill with an eligible player of that category — first non-dismissed batting-XI member (excluding the non-striker) for striker, first bowling-XI member not in `disabledBowlerIds` (which already excludes the previous over's bowler) for bowler. Cat 2 is "any" so it's a no-op. New `useEffect` in `scoreboard.tsx` keyed on `overCategory` only, so scorer-driven mid-over picks aren't overwritten. If no candidate matches (everyone of that category is out / disabled), the slot is left as-is and the existing pre-submit validation still toasts. Works for both innings since `Scoreboard` is the same component for innings 1 and 2.
- [x] **Boundary pill highlights on the scoring page (2026-05-17 late)** — the recent-balls strip now colour-codes boundaries off the bat: **4 → orange + bold** (`bg-orange-500/20 text-orange-700 dark:text-orange-400`), **6 → green + bold** (`bg-green-600/20 text-green-700 dark:text-green-400`). Precedence is wicket > 6 > 4 > default, and the highlight is keyed off `runs_off_bat` (not delivery total) so a NB+6 still pops as green even though the pill label reads `7nb`. Scoreboard only — the spectator `live-score-panel.tsx` has its own `renderBall` copy and is intentionally left alone.
- [x] **Match detail: Live tab (2026-05-17 late)** — adds a fourth tab to `/matches/[id]` (`MatchTabs`) called **Live**, positioned first and selected by default. Moves the previously-stacked `LiveScorePanel` (score, RR, partnership, batsmen / bowler cards, recent-balls strip) plus the completed-match `MatchAwards` (POTM trophy) into it, so the page is fully tab-organised instead of header + tabs split. URL contract: no `?tab=` → Live (was: Scorecard). Existing shared `?tab=scorecard|commentary|info` links still land on those tabs. `readTabFromURL` defaults to `"live"`; `setTab("live")` clears the param.
- [x] **Scorer can see Start-scoring CTAs on match detail (2026-05-17 late)** — `/matches/[id]` previously gated every admin button on `canManage = isTournamentOrganizer(...)`, which excluded scorers. They could open `/matches/[id]/score` directly (the page itself uses `requireTournamentAdmin`), but the **Start scoring this match** sticky CTA + the **Score** button in the header were invisible. Page now resolves *two* flags in parallel: `canManage = isTournamentOrganizer` (Edit, Toss form, XI picker — actions require organizer) and `canScore = isTournamentAdmin` (Start-scoring sticky CTA, Score button, Activity log link, POTM picker — those actions only require tournament-admin role server-side). Mirrors the existing action-level auth split so the UI now matches what the server already permits.
- [x] **Wicket modal: disable bowler in fielder picker for stumped (2026-05-17 late)** — a bowler can't physically stump the batter (wrong end of the pitch), but the fielder dropdown was treating the whole bowling XI as eligible. `WicketButton` now takes a `bowlerId` prop. Every row in the fielder picker carries a `(bowler)` suffix when it's the current bowler, and that row is `disabled` when `wicketType === "stumped"`. A small `useEffect` clears the fielder slot if the scorer flips Type to Stumped *after* having picked the bowler under another type, so stale selections don't sneak through. `caught` and `run_out` keep the bowler selectable since either is physically possible.
- [x] **Live tab caption + scorecard header trim (2026-05-17 late)** — `LiveScorePanel` now leads with a small batting-team caption above the score: `Wodeyars The Kings (1st inn)` (`(2nd inn)` for innings 2, `(super over)` for innings 3/4), styled `text-xs font-medium capitalize text-muted-foreground` to mirror the scoring page's top-of-card label. The old `CardDescription` line that read `<short> batting` / `<short> innings · chased 95` was redundant once that caption + the trophy card landed — removed. Free-hit and `CAT1/CAT3 over` pills survive in a conditional `CardDescription` that only renders when at least one is active. The `LAST 5 OV: 77 runs · RR 15.40` strip drops its `· RR <recent rr>` tail; now reads `LAST 5 OV: 77 runs`. Top-row run rate (`RR 15.50`) unchanged. Also dropped the duplicate `Scorecard / Per-player batting & bowling` header row inside the Scorecard tab — `full-scorecard.tsx` + `historical-scorecard.tsx` go straight into the `ScorecardInningsTabs`, since the tab label already names the section.
- [x] **Live tab: Partnership · RR · CRR strip + Compact batter/bowler table (2026-05-17 late)** — replaced the `Partnership · LAST 5 OV` strip with `Partnership · RR · CRR`, where `RR` is required-run-rate (only renders when `innings.target` is set, i.e. 2nd innings / super-over chase) and `CRR` is current overall run rate (`total_runs / overs_so_far`). Dropped `computeRecentRR` entirely. Then replaced the stacked colour-coded batsman / bowler cards with a single bordered table: header rows naming each stat column (`BATTER R B 4s 6s SR` · `BOWLER O M R W ER`), one compact row per player. Shared `TABLE_GRID_COLS` template — flex name column + 4 narrow stat tracks + a wider SR/ER track, `gap-x-1.5` so 7–10 char names like `Pradhyumna` fit on phones without truncating. Striker name + asterisk in green; bowler name in amber; category badges inline. Numbers `font-mono tabular-nums + text-right` keep columns aligned. `BatIcon` / `BallIcon` imports dropped (unused in the new layout).
- [x] **Super-over correctness pass (2026-05-17 late)** — driven by live testing where the super over rendered as a 7-over innings with Cat 1/3 restrictions still active and no path forward when both super-over innings tied. Four-part fix:
   - **Overs cap.** `scoreboard.tsx` and `live-score-panel.tsx` now compute `inningsOversCap = isSuperOver ? rules.super_over.overs : rules.overs_per_innings` (1 vs 7 for HVC). Used everywhere the overs total surfaces — the `X.Y / 1 OVERS` header, the `displayOvers` string, the chase strip's balls-left math. The engine already capped completion via `superOverOversDone`, so this is a UI-side display fix.
   - **No category context in super over.** `engine.ts`'s `computeSpecialOverContext` now takes `isSuperOver` and returns `null` when true — so a Cat 1 / Cat 3 striker no longer triggers special-batter / "stay" logic during innings 3+. Both call sites (`startInnings` + `advanceBowler`) pass the engine's `is_super_over` flag. Scoreboard `Category` dropdown is `disabled` in super over with the helper text `Super over · any striker / any bowler`; `overCategory` defaults to `2` at both initial render and over-boundary reset.
   - **Generalised phase machine for repeated super overs.** `derivePhase` (`state.ts`) walks super-over innings in pairs (3+4 = SO1, 5+6 = SO2, …). A tied pair falls through to the next; if no next pair exists, the phase returns `tied_pending_super_over` so the next super over can start. Decided pair → `super_over_decided` (or `match_complete` if `match.status === 'completed'`). The previous dead-end `super_over_tied` phase is no longer produced (kept in the type union for backward compat).
   - **`startSuperOverInnings` accepts innings ≥ 3.** Schema relaxed from `z.union([3, 4])` → `z.coerce.number().int().min(3)`. Batting-team rule generalised: odd innings_number (first leg) = batting team of the most recent prior leg (or `i2` for the very first super over); even (second leg) = sides flipped, target = first leg's runs + 1. Validation checks that the prior pair is complete + tied for first-leg innings ≥ 5, and that the first leg is complete for any second leg. `SuperOverPanel` derives the next innings number from `state.allInnings` instead of hardcoding 3/4, and the headline reads `Super over 1` / `Super over 2 — previous tied` / etc.

   All 21 engine tests still pass.
- [x] **Live card horizontal-room polish + Target chip (2026-05-17 late)** — `LiveScorePanel` card was eating 32px of horizontal room (default shadcn `px-4` on header + content). Tightened to `px-3 sm:px-4` so phones get 16px back, tablet+ unchanged. Recent-balls strip relabelled `Prev` / `This` → `Prev over` / `This over` (clearer at a glance); label column widened `w-12 → w-16` to fit, gap tightened `gap-3 → gap-2` so net horizontal cost is small. Added a `Target: 110` chip to the Partnership · CRR strip — only renders when `innings.target != null` (so 2nd innings / super-over chase) so innings 1 stays clean. Strip-visibility gate broadened to include `target != null` so the row appears immediately at the start of innings 2 even before the first ball lands.
- [x] **Playoff auto-scheduler: Q1 + Eliminator parallel (2026-05-17 late)** — Pavan clarified the desired bracket flow: from the points table top 1 vs top 2 = Q1, top 3 vs top 4 = Eliminator, Q1 loser vs Eliminator winner = Q2, Q1 winner vs Q2 winner = Final. Previous implementation chained Eliminator behind Q1 (only fired once Q1 finalised), which delayed it for no reason — the Eliminator pairing depends only on the points table, same as Q1. `maybeAutoSchedulePlayoffs` (`src/app/matches/[matchId]/score/actions.ts`) now: schedules **Q1 (#1 vs #2) AND Eliminator (#3 vs #4) in the same run** the moment the last group match wraps up; Q2 (Q1 loser vs Eliminator winner) once both are decided; Final (Q1 winner vs Q2 winner) once Q2 is decided. Switched the branch chain from `else if` to plain `if` so multiple stages can fire in one `finalizeMatch` run, with a memoised `getStandings()` so both Q1 + Eliminator share one points-table query. Idempotency unchanged (each branch still guards on `!stageAny`).

---

## 9b. Database migrations via Supabase CLI

Migration files live in `supabase/migrations/` with the CLI's
`YYYYMMDDHHMMSS_name.sql` naming convention. The Supabase CLI tracks
which have been applied to the remote project via the
`supabase_migrations.schema_migrations` table on the linked DB.

**To sync the linked DB after pulling** (the common case):
```bash
pnpm dlx supabase login           # first time only
pnpm dlx supabase link --project-ref cxysyglwooqmzcfvtmyl  # first time only
pnpm dlx supabase db push --linked
```
That applies any local migrations that aren't yet in the remote table.

**To create a new migration**:
```bash
pnpm dlx supabase migration new <descriptive_name>
# edit the SQL file that gets created in supabase/migrations/
pnpm dlx supabase db push --linked
```

**To see migration state**:
```bash
pnpm dlx supabase migration list --linked
# Local | Remote | Time — should match column-for-column when in sync.
```

**`db.sql` at repo root is the full schema** for fresh bootstraps —
not for incremental updates. New Supabase projects can start by pasting
db.sql into the SQL editor; existing ones use the migrations.

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

### Super-over: ICC compliance gaps (queued, 2026-05-17)

After the innings-cap fix landed (migration `20260517020000_*`), repeated super overs work end-to-end. These finer ICC rules are NOT yet enforced — flagged here so the next pass picks them up:

- **No-repeat bowler / batter across super overs.** ICC: any player who batted *or* bowled in a Super Over may not repeat in the next one. The app currently lets the scorer pick freely from the XI every leg. Fix: extend `startSuperOverInnings` validation + grey-out previously-used players in `super-over-panel.tsx`. Needs a way to compute "previously-used in any prior super-over leg" — query `balls` for distinct `bowler_id` + `striker_id` / `non_striker_id` per innings ≥ 3.
- **Win-margin wickets-out-of-`xi - 1` for super overs.** `finalizeMatchInternal` reports `wicketsLeft = players_per_side - 1 - so_winner.total_wickets`, so a side winning a 7-a-side super over with 0 wickets down reports "won by 6 wickets" instead of "won by 2 wickets" (out of the 2-wicket cap). Cosmetic but wrong. Fix: use `rules.super_over.max_wickets - so_winner.total_wickets` for super-over win-margin.
- **Pre-super-over batter nomination step.** ICC: each side nominates up to 3 batters before the super over begins. Today the picks happen ball-by-ball and the 2-wicket cap naturally limits to 3 batters, so the practical outcome matches — but a formal nomination UI would catch misconfigured XI rosters (e.g., a team with only 2 fit batters) before the over starts.

---

## 12. Project context for the AI assistant

If you're a Claude Code session reading this to pick up the work:

- The user's **collaboration style:** terse, prefers concise responses, doesn't need running commentary.
- They prefer **point-wise / structured explanations** over prose.
- They work **incrementally** — confirm direction before scaffolding code, don't jump ahead.
- They're comfortable with technical depth — you don't need to over-explain.
- **Don't suggest heavy/custom infra** — they explicitly chose Supabase for simplicity.
- **Don't add features beyond what was asked.** Three similar lines beats premature abstraction.

### Workflow policy: HANDOFF.md ships with every change (2026-05-17)

**Every change to this repo must include three things in the same commit:**

1. The code / SQL / scraper / config change itself.
2. A `HANDOFF.md` update describing what changed, why, and any caveats — extend the most recent dated section or add a new one. Keep the §1 TL;DR aligned.
3. A push to `main` (trunk-based — no PR review process; small team).

This is non-negotiable. After making any change: update `HANDOFF.md`, then `git add` + `git commit` + `git push origin main`. Don't batch across changes — every change ships with its own doc update and its own push. The whole point is that the next Claude session can pick up by reading `HANDOFF.md` alone and not have to reverse-engineer recent commits.

This policy supersedes any older preference suggesting "wait for explicit instruction before commit/push" — that preference no longer applies.

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
- **Super admins (today):** `pavan.gautham17@gmail.com`, `sudarshan61kv@gmail.com`

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
      actions.ts                       # createTournament / updateTournament / deleteTournament
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

## 14. Historical data — CricHeroes scrape (Seasons 1–6)

On **2026-05-16** the original "drop CricHeroes migration" decision was reversed (see §7). All 6 prior HVC seasons (2021–2025) were scraped and normalized into CSVs shaped 1:1 like our `db.sql` tables.

### Files added in this work

- **`scripts/scrape_cricheroes.py`** — Python 3, stdlib only. Run with `python3 scripts/scrape_cricheroes.py`. Idempotent; re-running overwrites raw JSON + CSVs in place.
- **`data/cricheroes/raw/`** — exact JSON dumps from CricHeroes (one file per tournament + one per match, 77 files). The source of truth. Re-running normalization without re-scraping is just reading these.
- **`data/cricheroes/csv/`** — output. Two flavors below.

### Schema-shaped CSVs (import these into Supabase)

Aligned 1:1 with our DB tables. Every row carries `cricheroes_*_id` source columns so the importer can remap to our UUIDs.

| CSV | Maps to | Rows |
|---|---|---|
| `tournaments.csv` | `tournaments` | 6 |
| `teams.csv` | `teams` | 39 |
| `players.csv` | `players` | 69 |
| `team_players.csv` | `team_players` | 164 |
| `matches.csv` | `matches` | 71 |
| `match_players.csv` | `match_players` | 925 |
| `innings.csv` | `innings` | 142 |

### Auxiliary historical aggregates (no DB target — defer)

CricHeroes scorecards don't expose ball-by-ball, so we can't synthesize `balls` rows. These three CSVs preserve per-batter/per-bowler/per-fall-of-wicket detail at the innings level.

| CSV | Rows |
|---|---|
| `historical_batting.csv` | 850 (per-batter per-innings: R/B/4s/6s/SR + how_to_out string + is_out) |
| `historical_bowling.csv` | 776 (per-bowler per-innings: O/M/R/W/dots/Wd/Nb/economy) |
| `fall_of_wickets.csv` | 684 |

Two options when you're ready to use them:
- **(a)** Add new tables `player_match_batting`, `player_match_bowling`, `match_fall_of_wickets` (denormalized historical-only). Extend `v_player_tournament_stats` to UNION ALL with these so career totals span both eras.
- **(b)** Live with Season-7-onwards stats only and ignore historical aggregates.

### How the scraper works (so you can debug or extend)

1. Fetches `https://cricheroes.com/tournament/236267/hvc-premier-league/matches/past-matches` (any cricheroes URL works) and parses `"buildId":"<id>"` from the embedded `__NEXT_DATA__` script.
2. For each tournament: hits `https://cricheroes.com/_next/data/<buildId>/tournament/<tid>/<any-slug>/matches/past-matches.json?tournamentId=<tid>&tournamentName=<any>&tabName=matches&innerTab=past-matches`. The `pageProps` blob contains `tournamentDetails`, `matchResponse` (list of matches), `teamResponse`, plus standings/leaderboards.
3. For each match: hits `https://cricheroes.com/_next/data/<buildId>/scorecard/<mid>/x/x-vs-x/scorecard.json`. **Slugs are ignored** — only `<mid>` matters. `pageProps.scorecard` is a 2-element list (one entry per innings) with `inning`, `batting[]`, `bowling[]`, `extras`, `fall_of_wicket`, `teamName`. `pageProps.summaryData.data` has match-level metadata (toss, ground, winner, POM).
4. Schema-shaped derivations the scraper performs:
   - `slug` → `hvc-season-1..6` (clean override of CricHeroes' inconsistent names)
   - `format` → `group_then_knockout` for all 6 (HVC pattern: 8 league + 3 qualifier + 1 final, ish)
   - `stage` from `tournament_round_name` → `group` / `qualifier` / `semi` / `final` / `exhibition`
   - `result_type` from `match_result` + `is_super_over` → `normal` / `tie` / `super_over` / `no_result` / `abandoned`
   - `toss_decision` parsed from `"Toss: <Team> opt to (bat|bowl|field)"`, with field → bowl
   - `team_players.role`: captain detected from `(c)` suffix in batter name; wicket_keeper detected from `†<Name>` in any dismissal text (e.g. `c †Sridhar b X`)
   - `players.batting_style` → `right_hand` / `left_hand` from RHB/LHB
   - `innings.total_legal_balls` from `overs_played` string (e.g. `5.5` → 35)
   - `innings.extras_wides/no_balls/byes/leg_byes/penalty` summed from `extras.data[]` by `type_code` (WD/NB/B/LB/P)
   - `innings.target` = innings 1 total + 1 (set only on innings 2)
   - `teams.short_name` derived (3–4 letter abbrev, skipping leading `Team `/`The `), unique within a tournament

### Re-running

```bash
python3 scripts/scrape_cricheroes.py
```

If you see a wall of 404s, CricHeroes redeployed and rotated `buildId`. The scraper auto-refreshes the buildId once on 404 and retries — usually transparent. The full 6-season run takes ~2 minutes (0.4s sleep between requests to be polite).

### How to load these CSVs into Supabase

**Importer ships as `scripts/import_cricheroes.ts`.** Run with:

```bash
pnpm run seed:cricheroes              # insert; bails on conflict
pnpm run seed:cricheroes -- --reset   # clear target tables then insert
```

**Safety guard:** the script refuses to run if `NEXT_PUBLIC_SUPABASE_URL` points at the prod project (`cxysyglwooqmzcfvtmyl`). Service-role bypasses RLS — running against prod would flatten data. To use against dev, switch `.env.local` to the dev project before running.

**What it does** (order matches HANDOFF §14 plan):

1. Loads `.env.local` (no `dotenv` dep — small inline parser). Builds a service-role Supabase client.
2. If `--reset`: deletes rows from `match_audit_events`, `balls`, `innings`, `match_players`, `team_players`, `matches`, `players`, `teams`, `tournaments` (reverse-FK order).
3. Inserts in FK order with in-memory `Map<cricheroes_id, uuid>` between phases: tournaments → teams → players → team_players → matches → match_players → innings.
4. **Player dedup:** for each row in `players.csv`, looks up an existing player by case-insensitive `display_name`. If found, points the cricheroes id at the existing UUID (no duplicate row). Useful when Season 7 has already created some players before the import runs.
5. Skips the auxiliary CSVs (`historical_batting`, `historical_bowling`, `fall_of_wickets`) — no DB target yet.
6. Logs counts per phase. Expected on a clean dev run: tournaments=6, teams=39, players=69, team_players=164, matches=71, match_players=925, innings=142.

### Caveats for the importer + the future-Claude

- **`recompute_innings()` trigger.** Our schema recomputes `innings` aggregates from `balls` rows on every insert/update/void. Importing historical innings with pre-filled aggregates and **no** balls will work, but if the trigger fires (e.g. an admin opens an edit form that touches the row), it will zero them out. Two ways to avoid this: (i) temporarily disable the trigger during the import + on the historical innings going forward (gate on `match.status='completed' AND scheduled_at < '2026-01-01'`?), or (ii) seed one stub `balls` row per innings that round-trips to the same aggregates (gross — don't).
- **Same-name player collisions.** Two real people sharing a display name are rare in 69 historical players but possible. Eyeball before merging.
- **One missing match.** Season 5 has 11 matches in the CSV instead of 12 (`12170963` is deleted on CricHeroes). Points table for Season 5 may be off by a few PTS. If anyone has an offline copy of that scorecard, seed it manually.
- **Logos.** `tournaments.csv` and `teams.csv` carry `logo_url` pointing at `media.cricheroes.in`. Either rehost into our `tournament-logos`/`team-logos` Supabase buckets, or just store the cricheroes URL and accept that CricHeroes might rotate URLs eventually. Recommend rehosting (one-time `curl` + `supabase storage cp` per logo, ~50 files).

### Why the scrape worked (technical context for future-Claude)

- CricHeroes is a Next.js app. Their App Router uses `_next/data/<buildId>/...json` for ISR/SSG data fetches. These endpoints are public — no `Authorization` header, no `Cookie` required — because the same data renders on the public scorecard page.
- The `buildId` is short-lived (rotates on every CricHeroes deploy). The scraper extracts it from any HTML page via `re.search(r'"buildId":"([^"]+)"', html)`.
- The team/match slug segments in the URL are **decorative** — only the numeric IDs are validated. So `scorecard/<mid>/x/x-vs-x/scorecard.json` works fine without knowing real slugs. This simplification skips a slug-resolution step that would otherwise force matching team names character-perfect.

---

## 15. Two-environment split — prod + dev (planned 2026-05-16)

The project is mid-flight in splitting the single Supabase project (`cxysyglwooqmzcfvtmyl`) into two environments. The existing project will become **prod** (tied to `main`); a new project will be **dev** (tied to a new `dev` git branch + Vercel preview deploys). Full plan + rationale lives at `/home/sudharshan/.claude/plans/swift-zooming-piglet.md`. Status:

### Done so far (code-only changes)

- **CricHeroes importer** at `scripts/import_cricheroes.ts` (Phase B of the plan). Idempotent with `--reset`; refuses to run against prod via hostname guard.
- **`package.json` scripts split:**
  - `gen:types` (no-arg) — prints a helpful error directing to one of the variants.
  - `gen:types:dev` — uses `$DEV_PROJECT_REF` env var.
  - `gen:types:prod` — hardcoded to the prod ref (cxysyglwooqmzcfvtmyl).
  - `seed:cricheroes` — runs the importer via tsx.
- **`tsx` added** to devDependencies (and `esbuild` whitelisted in `pnpm-workspace.yaml` `onlyBuiltDependencies` so the postinstall doesn't break `pnpm exec`).

### Done — provisioning + seeding (executed 2026-05-16)

1. **Dev Supabase project created**: `clqdimzthzcpurtwhtej` (Mumbai / ap-south-1, free tier, same org as prod).
2. **Schema applied to dev**: `db.sql` then `pnpm exec supabase db push --linked` — all 11 migrations applied. 5 storage buckets created (`tournament-logos`, `team-logos`, `player-photos`, `match-banners`, `user-avatars`).
3. **Fresh VAPID pair generated for dev** (separate from prod).
4. **Prod wiped** (was 7 users / 2 tournaments / 23 matches / 215 balls of "Test 2" data). SQL: truncate all 13 public data tables + delete auth.users + remove storage objects via API (raw SQL deletes blocked by the `storage.protect_delete()` trigger — Storage API works).
5. **CricHeroes historical data loaded into clean prod** via `ALLOW_PROD_IMPORT=1 pnpm run seed:cricheroes`. Final counts: tournaments=6, teams=39, players=64 (5 case-only cricheroes-side duplicates merged), team_players=275, matches=71, match_players=925, innings=142.
6. **Env templates** `.env.dev` and `.env.prod` checked out locally (gitignored) — copy whichever to `.env.local` before working.

### Importer-bug note for future-Claude

The first import run produced wrong cross-tournament team UUIDs because cricheroes **reuses `team_id` across tournaments** (e.g. "Hoysala Hunters" has `team_id=1597084` in all 5 seasons it appeared). Original importer keyed the `cricheroes_team_id → uuid` map by team_id alone, so 39 inserts collapsed to 19 map entries pointing at the latest-inserted UUID — and matches in older seasons resolved to the Season-6 team UUID. Fix shipped in `scripts/import_cricheroes.ts`: map is keyed by composite `"<cricheroes_tournament_id>:<cricheroes_team_id>"` and the importer maintains a `matchToTournament` side index so `match_players` + `innings` can resolve the correct per-tournament team UUID. `team_players` is now **derived from `match_players` after the fact** (one row per distinct `(team_uuid, player_uuid)` seen in match_players, role precedence captain > wicket_keeper > player) — the original `team_players.csv` was also broken by the same team_id collision.

### Historical scorecard rendering (added later 2026-05-16)

CricHeroes does **not** expose complete ball-by-ball for HVC matches. The `/api/v1/scorecard/v2/get-commentary/{matchId}` endpoint (headers `api-key: cr!CkH3r0s`, `device-type: web`, `udid: <any uuid>`) returns balls but they are systematically missing: real wicket dismissals (only retired-hurts come through) + the +1 penalty for wides/no-balls. Confirmed on S1 and S6 finals — commentary sums to 62/83 of the actual 85/102 runs. Not a scraper bug; cricheroes' own web UI shows the same incomplete data.

Workaround shipped: three new tables — `historical_match_batting`, `historical_match_bowling`, `historical_match_fall_of_wickets` — hold the per-innings aggregates we DO get from cricheroes' scorecard JSON. Migration `20260516020000_historical_match_aggregates.sql`. Importer extended to load them from `data/cricheroes/csv/{historical_batting,historical_bowling,fall_of_wickets}.csv`. Spectator UI: `src/app/matches/[matchId]/full-scorecard.tsx` checks `balls.length === 0` and delegates to a new `historical-scorecard.tsx` component when true — same visual layout, sourced from the new tables.

Final counts on prod after the extended import: `historical_match_batting=850`, `historical_match_bowling=776`, `historical_match_fall_of_wickets=477` (the CSV had 684 FoW rows but 207 were dupes — same wicket recorded multiple times in cricheroes' raw JSON; the importer's `unique (match_id, innings_number, wicket_no)` constraint deduped them cleanly).

What still doesn't work for historical matches: commentary feed, Manhattan/worm charts, `/players/[id]` career stats (the view reads from `balls`). Acceptable trade-off — the user explicitly asked for "just final scorecard information to display".

### Storage delete gotcha

`delete from storage.objects` raises `42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.` (Supabase has a `storage.protect_delete()` trigger guarding against orphans.) The wipe path uses the Storage JS API instead:

```js
const { data: folders } = await supabase.storage.from(bucket).list("", { limit: 1000 });
for (const folder of folders) {
  const { data: files } = await supabase.storage.from(bucket).list(folder.name, { limit: 1000 });
  await supabase.storage.from(bucket).remove(files.map(f => folder.name + "/" + f.name));
}
```

Note: `list("")` only returns immediate children (which are user-uuid folders for most uploads), so the recursion is required.

### Still pending — your action

1. **Sign up + super-admin promote on prod** (was wiped — both maintainers gone). Sign up via the live site, then:
   ```sql
   update public.profiles set is_super_admin = true
   where id = (select id from auth.users where email = '<your email>');
   ```
2. **Create + push the `dev` branch**:
   ```bash
   git checkout main && git pull
   git checkout -b dev
   git push -u origin dev
   ```
3. **Add Vercel env-var overrides scoped to the `dev` branch** (Project → Settings → Environment Variables, scope = Preview, branch = `dev`):
   - `NEXT_PUBLIC_SUPABASE_URL` → `https://clqdimzthzcpurtwhtej.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → see `.env.dev`
   - `SUPABASE_SERVICE_ROLE_KEY` → see `.env.dev`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` → see `.env.dev`
   - `VAPID_PRIVATE_KEY` → see `.env.dev`
   - `VAPID_SUBJECT` inherits from Production (no override needed)

### Day-to-day workflow

- **Switch local env**: `cp .env.dev .env.local` (default) or `cp .env.prod .env.local` (when actually testing prod). Both template files are gitignored.
- **Migrations propagate dev-first:**
  1. Author migration → `pnpm exec supabase link --project-ref clqdimzthzcpurtwhtej && pnpm exec supabase db push --linked` against dev.
  2. PR lands on `dev` branch. Vercel preview validates.
  3. PR `dev → main`. After merge, manually apply to prod from a clean `main` checkout: `pnpm exec supabase link --project-ref cxysyglwooqmzcfvtmyl && pnpm exec supabase db push --linked`. No auto-apply — intentional gate.
- **`gen:types:dev`** is the default day-to-day type regeneration. Run after a dev migration applies. `gen:types:prod` only after a prod migration applies + only if dev/prod schema drifted (shouldn't happen if you follow the propagation order).
- **`supabase link` is per-checkout** — the link state lives in `supabase/.temp/linked-project.json` (git-ignored). Always confirm which project you're linked to before `db push`. **If `db push --linked` ever reports unapplied migrations on prod you don't recognize, STOP — coworker has unpushed changes.**
- **Free-tier pause:** dev pauses after 7 days idle. Either tolerate the cold start or schedule a weekly `curl` against the dev URL.

---

## 16. Spectator UI polish + identity sync (2026-05-16 evening)

Once the 6 historical seasons were on prod and Pavan/Sudarshan started clicking around, several feel-broken-when-linked issues surfaced. This section documents what shipped to fix them. All changes are live on both prod and dev.

### Tournament home: champion hero

`src/app/tournaments/[slug]/tournament-champion.tsx` (server component) renders above the existing tabs strip when `tournament.status = 'completed'`. Returns null otherwise.

- **Champion** — winning team's logo + name + win margin ("won by 4 wickets"). Sourced from the match where `stage='final'` and `winner_id` is set.
- **Runner-up** — surfaced inline with both teams' final scorelines (`52/2 (6.1)` vs `50/5 (7.0)`).
- **Player of the Tournament** — count of `matches.player_of_match_id` per player; ties broken by total runs queried from BOTH `balls` and `historical_match_batting` so works for both eras.

On the 6 historical seasons: 4 have a clear POTM by POM count; 2 (S1 + S2) resolve via the run tie-break.

### Homepage rebuild

The "No matches live right now — Browse tournaments" empty Card was wasting the screen. Replaced with two always-on server components plus the existing live/upcoming/recent sections:

- `src/app/home-my-profile.tsx` — 1-row strip only renders for signed-in users with a linked player. Avatar + name + category + career snapshot (matches/runs/wickets). Click-through to `/me`.
- `src/app/home-past-tournaments.tsx` — grid of 6 most-recent completed tournaments. Each tile: tournament logo + name + dates + 🏆 + champion crest. Click-through to the tournament page (where the new champion hero renders).

Render order on the homepage:
1. Hero
2. Live now (if any)
3. Your profile strip (if linked)
4. Up next (24h window)
5. Recent results (last 5)
6. Past tournaments grid (always when completed tournaments exist)
7. Footer

### `/me` restructure

Dropped the "Super admin shortcuts" card — the nav + context buttons on the actual entity pages already cover those flows; `/me` is for "who am I + what's my cricket record", not a control panel.

`ProfileCard` now takes optional `playerCategory` + `playerBattingStyle` + `playerBowlingStyle` so the linked user's full identity shows in one header (instead of being split across two cards). The body of the page below is the shared `PlayerCareerSection` (see below).

### Shared `PlayerCareerSection` component

`src/components/player-career-section.tsx` (server component, takes `playerId`). Owns:

- The 9-stat Career card (Matches / Innings / Runs / 4s / 6s / SR / Wickets / Overs bowled / Econ — `v_player_tournament_stats` is historical-aware via migration `20260516030000`)
- The By-tournament table (sticky-left tournament column on mobile)
- All data fetching (innings count combining `balls` + `historical_match_batting`)

Both `/me` and `/players/[id]` mount this directly:

```
/players/[id] → header + <PlayerCareerSection /> + nothing else
/me           → ProfileCard + <PlayerCareerSection /> (when linked)
```

Two pages, one component. Net of ~460 lines of duplicated query + render code deleted across the original two pages. Any future career-stat change lands in one place.

### Identity sync triggers

Two pairs of `AFTER UPDATE` triggers keep linked-user identity consistent:

- **Photo/Avatar**: `20260516040000_sync_avatar_photo.sql` — `profiles.avatar_url ↔ players.photo_url`.
- **Display name**: `20260516050000_sync_display_name.sql` — `profiles.display_name ↔ players.display_name`.

Same pattern on both: when one side updates, the other follows. `is distinct from` guards on both ends prevent infinite recursion — when trigger A fires and writes to the other side, the other side's UPDATE fires trigger B which sees `NEW = target value already` and the WHERE clause's `is distinct from` is false, so the inner update is a no-op.

Backfill on apply:
- Photo: any side has a value while the other is null → copy the non-null side across.
- Display name: same null-side copy. **Plus**: if both are set and different, `profile.display_name` wins (auth identity is canonical). User can rename either side after and the trigger keeps them in sync.

This is why uploading a photo on `/players/[id]/edit` now shows up immediately on `/me`, and renaming on either side reflects on the other.

### Match-list visual polish

`src/app/tournaments/[slug]/page.tsx` — `TeamMini`:

- Was showing the 3-letter `short_name` in mono uppercase (`VAD / BRA / HOY`). Now shows the team's full `name` with "Team " prefix stripped (`Vadiraja Thirtharu / Brahmanya Thirtharu / Hoysala Hunters`). Truncates with ellipsis + a tooltip with the full name.
- Logo URLs were stored as bare cricheroes filenames on the 20 teams that had them; backfilled on prod with the full `https://media.cricheroes.in/team_logo/<filename>` URL via a one-shot SQL update + the importer fixed for future runs.

### Routing tweaks for linked users

- `/players` list: clicking a row that belongs to the signed-in user lands on `/me` instead of `/players/[id]`. Every other row still goes to `/players/[id]`. (`src/app/players/page.tsx`.)
- `/players/[id]` Edit button: for the linked user (non-admin), routes to `/me`. Admins still get the full `/players/[id]/edit` form. Anon viewers + non-linked users see no Edit button.

### New migrations applied (this session, both prod + dev)

```
20260516020000_historical_match_aggregates       # tables for old-season stats
20260516030000_extend_v_player_tournament_stats  # historical-aware view
20260516040000_sync_avatar_photo                 # photo sync triggers
20260516050000_sync_display_name                 # name sync triggers
```

### New / changed files in `src/`

```
src/components/player-career-section.tsx          (new — shared between /me + /players/[id])
src/app/home-my-profile.tsx                       (new — homepage personal strip)
src/app/home-past-tournaments.tsx                 (new — homepage tournament grid)
src/app/tournaments/[slug]/tournament-champion.tsx (new — champion hero card)
src/app/matches/[matchId]/historical-scorecard.tsx (new — earlier today; fallback scorecard)
src/app/me/page.tsx                                (rewritten — uses PlayerCareerSection)
src/app/me/profile-card.tsx                       (extended — accepts player metadata)
src/app/players/[playerId]/page.tsx                (slimmed — uses PlayerCareerSection)
src/app/players/page.tsx                          (own row → /me)
src/app/tournaments/[slug]/page.tsx               (TeamMini: full names; +champion hero mount)
src/app/page.tsx                                  (homepage redesign)
src/app/matches/[matchId]/full-scorecard.tsx      (delegates to historical when balls empty)
src/lib/supabase/database.types.ts                (3 new tables typed)
scripts/import_cricheroes.ts                     (loads historical aggregates; logo URL fix)
```

---

## 17. Cricheroes leaderboard parity — MVP / POTM / Stats (2026-05-17)

§16 shipped a champion hero with a Player-of-the-Tournament card and a working scorecard for historical seasons. What stayed broken was the **MVP** and **Stats** tabs: both read exclusively from the `balls` table, which is empty for every CricHeroes-imported match. MVP on Season 6 had every Hoysala Hunters player tied at 80 — our HVC formula was running with zero balls, so only the `+10 per win` team bonus accumulated (HOY won 8 → 80 each). This section is what shipped to fix that, plus the Stats-tab work and the morning UI tweaks.

### MVP: mirror cricheroes' published leaderboard

The HVC formula in `@/lib/scoring/mvp.ts` is tuned for our 7-over format and isn't reverse-compatible with cricheroes' proprietary formula (different weights, decimal totals). Trying to re-derive it locally would never match what spectators already saw on cricheroes. Decision: **import cricheroes' MVP rows verbatim** for the 6 historical tournaments and render them through the same view component.

**New table** (`supabase/migrations/20260517000000_historical_tournament_mvp.sql`):

```sql
historical_tournament_mvp (
  id, tournament_id, player_id, player_name, team_id,
  rank, matches,
  batting_points, bowling_points, fielding_points, total_points  -- all NUMERIC
)
```

Public-read RLS, unique on `(tournament_id, player_id, player_name)`. **Applied to prod only** (`hvc-scoring` / `cxysyglwooqmzcfvtmyl`) — Pavan explicitly opted out of dev because nothing in dev uses historical data.

**Scrape** — `scripts/scrape_cricheroes.py` gained `fetch_mvp_leaderboard(tid)` hitting `https://api.cricheroes.in/api/v1/mvp/get-tournament-player-mvp/{tid}` (path-style, not query-string — different from the rest of the api endpoints). Returns one row per player who appeared in the tournament, already ranked, with `batting/bowling/fielding/total` as decimal strings. Pulled 275 rows total across S1–S6 (S1:37 S2:44 S3:42 S4:49 S5:52 S6:51), raw JSON at `data/cricheroes/raw/mvp_<tid>.json`, aggregate CSV at `data/cricheroes/csv/tournament_mvp.csv`.

**Import** — two paths now exist:

1. `scripts/import_cricheroes.ts` — full-tournament importer. Got a step 11 that loads `tournament_mvp.csv` into `historical_tournament_mvp` using the existing in-memory `cricheroes_*_id → uuid` maps that were already built for steps 1-10. Used when you `--reset` everything from scratch.
2. `scripts/import_cricheroes_mvp.ts` — **new**, targeted MVP-only importer. Reads `tournaments.csv` + `teams.csv` + `players.csv` + `tournament_mvp.csv`, queries the live DB for matching tournaments (by slug), teams (by `(tournament, name)`), and players (by case-insensitive `display_name`) to rebuild the UUID maps without inserting anything, then writes only the MVP rows. **Safe to run against prod without `--reset`** — preserves `player.linked_user_id` and every other downstream link.

Run against prod (`.env.local` is pointed at prod):

```
ALLOW_PROD_IMPORT=1 pnpm exec tsx scripts/import_cricheroes_mvp.ts
```

(Node 22+ required — `@supabase/supabase-js` 2.105 needs native WebSocket. Use `PATH="…/.nvm/versions/node/v22.X/bin:$PATH"`.)

**One row was skipped**: cricheroes had two distinct profiles for "Ajith P" in S6 (player_ids 8670699 + 29578223, ranks 49 + 50, both with negligible scores). Both mapped to our single "Ajith P" UUID; the unique constraint kept the higher rank (49) and dropped 50. 274/275 inserted.

**UI fallback** — `src/app/tournaments/[slug]/tournament-mvp.tsx`:

```ts
// Historical fallback first; falls through if no rows exist.
const historical = await loadHistoricalMvp(supabase, tournamentId);
if (historical) return historical;
// …existing balls-based compute…
```

`loadHistoricalMvp` queries by `tournament_id`, joins to `players` for display_name + avatar + category, builds `MvpEntry[]`, and returns the same `TournamentMvpView` with `source="cricheroes"`. The view branches on `source`:

- Cricheroes path: 3-decimal totals (`.toFixed(3)`), no per-category chips (cricheroes' MVP is one combined list), drops the "Team:" breakdown row, swaps the formula explainer for `CricheroesFormulaCard` ("This season was scored on CricHeroes…").
- HVC path: integer totals, Cat 1/2/3 chips, full breakdown including team bonus, original formula card.

### POTM card pivot for historical

`src/app/tournaments/[slug]/tournament-champion.tsx` previously always used "most match-POM awards" + tie-break by total runs. For historical seasons that gives the wrong answer — POM awards are per-match judgement calls and don't track MVP rank. Pre-fix: S5 showed Ashrith Kashyap (4 POM awards) while the MVP tab below showed Mady at rank 1 (22.400). Post-fix: card shows Mady.

New helper `pickHistoricalPotm(supabase, tournamentId)` queries `historical_tournament_mvp` for rank 1; if no row, returns null and falls through to the existing POM-count `pickPotm`. POTM return shape was generalized to `{ id, display_name, metric: { value, label } }` so historical can render "22.400 MVP score" while live keeps "4 POM awards".

### Stats tab: historical fallback

`tournament-stats.tsx` previously returned "No balls bowled yet." when `balls` was empty. Now it falls back to `loadHistoricalStats(supabase, matchIds, innings)`, which reads `historical_match_batting/bowling`, maps `(match_id, innings_number) → innings.id`, and feeds the rows through the **same** `BatAgg` / `BowlAgg` accumulators the balls-based path uses. Both compute paths now share module-level helpers: `newBatAgg`, `newBowlAgg`, `newFieldAgg`, `accumulateBatInnings`, `accumulateBowlInnings`.

`PerInnBat` / `PerInnBowl` types are also shared. `BatAgg` gained `fifties` (count of innings ≥ 50 runs); `BowlAgg` gained `maidens` + `dots` (sums of per-innings figures); `FieldAgg` is new (catches / run_outs / stumpings).

### Stats tab: cricheroes-style layout

Replaced the long scroll of 6 stacked leaderboards with a section + style layout that mirrors cricheroes' leaderboard page:

```
[All] [Cat 1] [Cat 2] [Cat 3]                ← existing category chip
[BAT] [BOWL] [FIELD]          [Style ▼]      ← new section pills + sub-style dropdown
<one LeaderTable for the active leaderboard>
```

17 leaderboards in total: 7 batting (Top Runs / Highest Scores / Best SR / Best Avg / Most 4s / Most 6s / Most 50s), 7 bowling (Most Wickets / Best Avg / Best Econ / Best SR / BBI / Most Maidens / Most Dots), 3 fielding (Most Catches / Run Outs / Stumpings). **FIELD is hidden entirely on cricheroes-imported tournaments** — the cricheroes commentary feed doesn't expose per-ball fielder credits, so there's nothing to aggregate. Most Centuries is omitted by design (unreachable in 7 overs).

Min-sample thresholds for ratio leaderboards:
- Batting SR: ≥ 12 balls faced
- Batting Avg: ≥ 3 innings
- Bowling Econ: ≥ 12 legal balls bowled
- Bowling Avg / SR: ≥ 2 wickets

### Stats pagination

`buildLeaderboards` sends every qualifying row (capped at 500 for safety; real counts are ≤ ~50). `LeaderTable` paginates client-side at 10 rows/page with Prev/Next + "N–M of total". Rank stays absolute (page × PAGE_SIZE + idx + 1) so #1 on page 2 reads as 11. The parent passes `key={`${filter}:${styleId}`}` on `LeaderTable` so React remounts on switch and the page resets to 1 — avoids the `react-hooks/set-state-in-effect` lint rule.

### Stats column-width fix

Player column was taking the longest entry's natural width and pushing stat columns off-screen on mobile (a horizontal scroll was visible for any name like "Pradhdhyumna Kashyap HP (Wk)"). Pinned at 140px on mobile / 200px on `sm+`; name span switched from `truncate` to `break-words leading-tight` so long names wrap to a second line. Rank chip is now `items-start` + `mt-0.5` so it stays aligned with the first text line on multi-line rows.

### Morning UI tweaks (same day, earlier)

Pre-existing changes that landed as separate small commits before the cricheroes work:

- **Match complete: explicit finalize + Undo last ball.** `recordBall` no longer auto-finalizes when innings 2 (or super-over innings 4) ends. The match enters a "pending finalize" state and the `MatchCompletePanel` exposes "Finish match" alongside "Undo last ball" so a mis-tapped delivery can be rolled back before the result locks in. Match-completion push fan-out moved with completion — single dispatch from `finalizeMatch` on confirm, no fan-out on the optimistic last ball.
- **Scoreboard chase line.** Second-innings footer reads "Need *X* runs from *Y* balls · Target *T*" instead of just "Need X runs to win".
- **Pick XI select-all.** Header row of the squad table has a master checkbox that toggles every player's `included` flag at once, with indeterminate state when partially selected. Clears captain / keeper / sub flags + batting_order when unchecking.
- **Homepage innings join.** Embed switched to `innings!innings_match_id_fkey(...)` so the FK is unambiguous now that `historical_match_*` tables also reference `matches`.

### Same-day follow-ups (later 2026-05-17)

- **Team squad: category chip.** `/tournaments/[slug]/teams/[teamId]` shows a coloured `C1` / `C2` / `C3` chip after every roster name. Same amber / muted / sky palette scoring and stats already use. Helps organisers verify category assignments before a tournament starts.
- **Wicket modal: fielder mandatory for caught / run-out / stumped.** Save button toasts "Pick the fielder…" when the picker is empty for any of those three dismissal types. `recordBallSchema` gained a Zod `.refine()` so an older or tampered client can't bypass it server-side either. `caught_and_bowled` unaffected (bowler is the implicit fielder). Stops commentary from rendering "WICKET! X caught by ? off Y" and stops the wicket dropping from Most Catches / Run-outs / Stumpings.
- **Appi's tournament seed (dev only).** `scripts/seed-appis-tournament.sql` — 4 teams, 28 players, 6 single-round-robin matches for the `round_robin_playoff_final` test tournament; 1 Cat 1 + 1 Cat 3 per team so the special-over rules are exercisable. Run via `pnpm exec supabase db query --linked --file scripts/seed-appis-tournament.sql` after `supabase link --project-ref clqdimzthzcpurtwhtej`. Playoff bracket auto-schedules via `maybeAutoSchedulePlayoffs` once all 6 group matches go terminal.

### New / changed files

```
supabase/migrations/20260517000000_historical_tournament_mvp.sql   (new — prod only)

scripts/scrape_cricheroes.py                          (+ fetch_mvp_leaderboard, + main loop wiring)
scripts/import_cricheroes.ts                          (+ step 11: tournament_mvp.csv → historical_tournament_mvp)
scripts/import_cricheroes_mvp.ts                      (new — targeted prod-safe MVP importer)
data/cricheroes/csv/tournament_mvp.csv                (new — 275 scraped rows)
data/cricheroes/raw/mvp_<tid>.json × 6                (new — raw scrape per tournament)
.gitignore                                            (+ scripts/__pycache__)

src/app/tournaments/[slug]/tournament-mvp.tsx         (loadHistoricalMvp fallback)
src/app/tournaments/[slug]/tournament-mvp-view.tsx    (source prop + CricheroesFormulaCard)
src/app/tournaments/[slug]/tournament-champion.tsx    (pickHistoricalPotm; metric shape)
src/app/tournaments/[slug]/tournament-stats.tsx       (shared helpers; loadHistoricalStats; expanded buildLeaderboards)
src/app/tournaments/[slug]/tournament-stats-view.tsx  (BAT/BOWL/FIELD + style dropdown + pagination + width fix)

src/app/matches/[matchId]/score/actions.ts            (drop auto-finalize from recordBall; push moves to finalizeMatch)
src/app/matches/[matchId]/score/match-complete-panel.tsx (Finish match + Undo last ball pair)
src/app/matches/[matchId]/score/scoreboard.tsx        (chase line: balls remaining)
src/app/matches/[matchId]/xi/[teamId]/pick-xi-form.tsx (select-all header checkbox)
src/app/page.tsx                                      (innings_match_id_fkey)
src/lib/supabase/database.types.ts                    (+ historical_tournament_mvp row/insert/update)

scripts/seed-pavs-tournament.sql                      (new — 7-team / 49-player / 21-match round-robin for dev)
scripts/seed-appis-tournament.sql                     (new — 4-team / 28-player / 6-match round-robin for dev; 1×C1 + 1×C3 per team)

src/app/tournaments/[slug]/teams/[teamId]/page.tsx    (squad list: C1/C2/C3 chip after each name)
src/app/matches/[matchId]/score/wicket-button.tsx     (fielder picker now mandatory for caught/run_out/stumped)
src/app/matches/[matchId]/score/actions.ts            (recordBallSchema .refine(): fielder required for caught/run_out/stumped)
```

---

## 18. Pagination fix, full re-scrape, league-only standings (2026-05-17)

This was the actual content of commit `4ff6497` ("updated cricheroes data"), which had a sparse message. Documenting here.

The 2026-05-16 cricheroes import looked clean but was missing roughly half the matches. CricHeroes' "League Matches" table for Season 6 showed 25 matches (7 teams × 6 league + knockouts); our standings showed teams playing 2–6 matches each. Root cause: the scraper only ever captured page 1 per tournament.

### Root cause: silent pagination

`scripts/scrape_cricheroes.py` originally read `pageProps.matchResponse.data` from the `past-matches.json` Next.js data endpoint — that's only the first 12 matches per tournament. The underlying `https://api.cricheroes.in/api/v1/match/get-tournament-matches/3/-1/-1` endpoint paginates by **(pageno, datetime)** together; `datetime` is a server-minted cursor handed back in `page.next` on the first response. **If you pass `pageno=N` without `datetime`, the API silently re-serves page 1 regardless of `pageno`.** No error, no warning — the loop just looked like it hit EOF after 12 rows.

### Fix

Added `fetch_tournament_matches(tid)` paginator + `API_HEADERS` constant to the scraper. Extracts the `datetime` cursor from page 1's `page.next` and replays it on subsequent requests:

```python
API_HEADERS = {
    "api-key": "cr!CkH3r0s",
    "device-type": "web",
    "udid": "hvc-scraper-stable-id",
}

def fetch_tournament_matches(tid: int) -> list[dict]:
    """Paginate /match/get-tournament-matches and return every completed match.
    Cricheroes pages by (pageno, datetime) — the `datetime` cursor is minted on
    page 1 and must be passed back on subsequent pages, otherwise the API
    silently re-serves page 1 regardless of `pageno`."""
    ...
```

Required headers (all three are mandatory — missing any produces `2003 UDID not found` / `2004 Device-type not found` errors): `api-key: cr!CkH3r0s`, `device-type: web`, `udid: <any stable id>`. Synthetic values are fine — they don't need to match a real session. `main()` no longer reads `matchResponse.data`; it calls the paginator directly.

### Re-scrape + re-import (prod)

Run with `ALLOW_PROD_IMPORT=1 pnpm run seed:cricheroes -- --reset`. The `--reset` flag truncates target tables in reverse-FK order before inserting. Before → after counts on prod:

| Table | Before | After |
|---|---:|---:|
| matches | 71 | 131 |
| match_players | 925 | 1729 |
| innings | 142 | 266 |
| historical_match_batting | 850 | 1602 |
| historical_match_bowling | 776 | 1446 |
| historical_match_fall_of_wickets | 477 | 873 |
| tournaments | 6 | 6 |
| teams | 39 | 39 |
| players | 64 | 65 |
| team_players | 275 | 308 |

Tournament UUIDs rotated because `--reset` truncated and re-inserted. Current UUIDs as of 2026-05-17:

| Season | UUID |
|---|---|
| hvc-season-1 | `c5c74662-b952-4be1-aaa2-52a973fea034` |
| hvc-season-2 | `b6a2d810-9704-42e9-a257-8ec01e232304` |
| hvc-season-3 | `bab12fcd-d292-4189-8f56-6023a9661830` |
| hvc-season-4 | `43c65fc5-0598-4fd9-bf5d-7fbeff191b46` |
| hvc-season-5 | `5f3a35ad-f144-42b4-abdd-3b1d1477a2d9` |
| hvc-season-6 | `3c2f7696-0cfe-47b3-b4c1-f25a1fa45ccb` |

The MVP-only importer (`scripts/import_cricheroes_mvp.ts`, see §17) resolves UUIDs by slug/name and re-runs cleanly after any `--reset`, so the rotated tournament UUIDs don't require manual fixup downstream.

### Sudharshan re-link

`--reset` wiped the players table. The fresh scrape produced a row with `display_name='Sudharshan'` (the 2026-05-16 row had `display_name='Sudharshan V'`) and no `linked_user_id`. Re-linked via PostgREST PATCH:

```bash
curl -X PATCH "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/players?display_name=eq.Sudharshan" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"linked_user_id":"e583ac39-9516-4c74-bb2f-954dc830d091"}'
```

Pavan's player row needs the same treatment if/when re-imports recur — `display_name` patterns can shift across cricheroes scrapes (capitalization, middle initials).

### Standings still wrong: stage-aware points table

After the re-import, S6 standings showed Hoysala Hunters with P=9 instead of 6. Root cause: `v_points_table` (originally defined in `db.sql:639`) counted every completed match — `stage='group'` plus `qualifier`, `semi`, `final` all blended into a single row's W/L/P. Cricheroes (and every league-style points table) renders ONLY the round-robin phase, with knockouts shown separately.

New migration **`supabase/migrations/20260516100000_points_table_league_only.sql`** adds `where stage = 'group'` to both branches of the UNION ALL inside the view:

```sql
create or replace view v_points_table as
with results as (
  select m.tournament_id, m.team_a_id as team_id, ...
  from matches m
  where m.status = 'completed' and m.stage = 'group'   -- new filter
  union all
  select m.tournament_id, m.team_b_id as team_id, ...
  from matches m
  where m.status = 'completed' and m.stage = 'group'   -- new filter
)
...
```

Applied to prod with `pnpm exec supabase db push --linked` while linked to `cxysyglwooqmzcfvtmyl`. Dev still needs the same `db push --linked` while linked to `clqdimzthzcpurtwhtej` (the migration file is committed; the apply is per-environment).

NRR calc in the app already reads from `v_points_table`'s output, so it inherits the same league-only filter implicitly — no separate fix needed.

**Verification:** S6 standings now exactly match cricheroes' "League Matches" table — 6/6/0, 6/5/1, 6/4/2, 6/3/3, 6/2/4, 6/1/5, 6/0/6 across the 7 teams.

### Files (already in `main` from commit 4ff6497 + this doc-only follow-up)

```
scripts/scrape_cricheroes.py                                       (paginator + API_HEADERS)
supabase/migrations/20260516100000_points_table_league_only.sql    (new)
data/cricheroes/csv/*.csv                                          (regenerated, all 7 tables)
data/cricheroes/raw/*.json                                         (60 new match JSON files)
HANDOFF.md                                                         (this §18 + §1 TL;DR + §12 policy)
.claude/scheduled_tasks.lock                                       (removed — accidentally committed)
```

### Lessons for the next scraper bug

- **Trust the count, not the loop.** When cricheroes' UI says 25 matches and the scraper produces 6, the loop is lying. Cross-check totals against the rendered tournament page before declaring an import "clean".
- **Page 1 looks like the whole world** if the API silently ignores your pagination. Always inspect `page.next` (or whatever the cursor field is called) on the first response and confirm subsequent requests *change* the result set.
- **Headers on `api.cricheroes.in` are picky but not authenticated.** Missing `api-key` / `device-type` / `udid` produces hard 4xx errors with specific codes (2003, 2004, etc.); presence of synthetic values is fine. Pro auth (cookies + `authorization` header) does NOT unlock additional ball-by-ball — only marketing-style `summaryData.insights` strings. Don't bother with pro auth for this scrape.
- **`/api/v1/scorecard/v2/get-commentary/{matchId}` is rate-limited.** A burst of >5–8 requests within seconds triggers a 60–120s cooldown returning err `20250404`. Space requests by ~5–10s if you ever need this endpoint (we don't, for the historical scrape — commentary data is incomplete anyway; see §15 "Historical scorecard rendering").

---

## 19. Scorer pre-match flow + NRR data fix (2026-05-17 late)

Two testers (Appi, Pranav) started clicking through the actual organizer → scorer flow on dev and surfaced a stack of papercuts plus one real data bug. This section covers what shipped to fix them.

### "Start scoring" no longer reads like a tab

`src/app/matches/[matchId]/page.tsx`. The header for a scheduled match used to render `Start scoring · Activity · Edit` as three same-size buttons in one row — the filled primary pill of "Start scoring" sat right next to the two ghost buttons and visually read as a selected tab in a strip. Testers waited for content to load below it rather than tapping through.

For `status='scheduled'` the CTA now renders **outside** that row as a full-width Link card below the header band: Play icon + "Start scoring this match" + a hover-animated ChevronRight. Activity / Edit stay as the small ghost buttons in the header. For `live` / `innings_break` the compact "Score" pill stays in the header — those matches are clearly already in motion so the tab confusion doesn't apply.

### Inline toss + XI on the score page

`src/app/matches/[matchId]/score/page.tsx`. Previously, a scorer who landed on the score page before toss was set or before both XIs were picked saw a static card that said "Set the toss on the match page" or "Pick XI on the match page" — they had to navigate back, find the form, save, then come back. Three round-trips before they could record a ball.

Now the score page renders `<TossForm>` + `<XISection>` directly when either is missing. The full checklist lives on one page; nothing redirects.

### Auto-save toss

`src/app/matches/[matchId]/toss-form.tsx`. Save button removed entirely. The form watches both selects; once they're both set and the pair differs from whatever the server has, it commits via `setToss` and replaces the picker with a one-line summary `Royal Strikers · bat first ✓ [Edit]`. Tapping Edit reopens the picker; any change auto-saves again. Status text under the picker doubles as save feedback (idle hint / `Saving…` / `Saved.`). Same component is shared with the match-page Edit, so the behaviour applies everywhere.

### Pick XI: In / Player / Sub only

`src/app/matches/[matchId]/xi/[teamId]/{pick-xi-form,page}.tsx`. Dropped three columns that duplicated state living elsewhere:

- **Order** — striker / non-striker are picked live each ball on the scoreboard; the 1–N grid was always going stale.
- **Captain** — already a roster role on the team squad (`/tournaments/[slug]/teams/[teamId]`), so it's tournament-level, not per-match.
- **Wicket-keeper** — keeper changes per delivery in box cricket; the slot picker on the scoreboard handles it live.

Dropped the captain/keeper count validations along with the columns. `match_players.is_captain / is_keeper / batting_order` columns stay (nullable + default false); older matches keep their values, this form just doesn't set them anymore. Header copy updated to explain where those fields actually live.

`Save XI` now calls `router.back()` after a successful save so the scorer lands back where they came from (score page when in the pre-scoring flow). One toast, no manual nav.

### NRR rendered `—` for every team — embed ambiguity

`src/app/tournaments/[slug]/points-table-section.tsx`, `src/lib/standings.ts`, `src/app/tournaments/[slug]/tournament-champion.tsx`. Standings on Pranav's tournament (which had completed matches) showed correct W/L/Pts but `—` in the NRR column. Confirmed via raw PostgREST:

```
?select=...,matches!inner(tournament_id,status)
→ HTTP 400 PGRST201
  "Could not embed because more than one relationship was found for 'innings' and 'matches'"
  Try matches!matches_current_innings_fk or matches!innings_match_id_fkey
```

`matches` has two FKs to `innings`: the parent `innings.match_id → matches.id` (`innings_match_id_fkey`) **and** the live-innings pointer `matches.current_innings_id → innings.id` (`matches_current_innings_fk`). The embed didn't pick one and PostgREST refused to guess; `data` came back null, the NRR map stayed empty, and `fmtNrr(undefined)` rendered `—`. Same root cause as the homepage match-card embed fix earlier in the day.

Pinned to `matches!innings_match_id_fkey` in all three call sites. Same fix applies to:
- the points-table query that drives the Standings card,
- `lib/standings.ts` (shared by the playoff auto-scheduler, so the bracket would have used the wrong NRR tie-break when standings tied on points),
- the balls→innings→matches chain in `tournament-champion.tsx` (POTM tie-break by total runs).

**Lesson for future-Claude:** any time you embed `matches` from `innings` (or anywhere a chain passes through both), spell out `!innings_match_id_fkey` — the live-innings pointer reference will keep biting otherwise. PostgREST 400 is silent in the Next.js page (`data` is null, the page renders an empty state), so this fails quietly until someone notices the column is wrong.

### Points table: narrower Team column

Same treatment as the Stats table earlier — pinned the Team column at 130px on mobile / 180px on `sm+` so PTS + NRR have breathing room on narrow screens. `min-w-[34rem]` on the inner table still allows horizontal scroll for the rest of the columns.

### Pranav's tournament seed (dev)

`scripts/seed-pranavs-tournament.sql`. Second test tournament for a second tester, distinct from Appi's:

- Format `round_robin_playoff_final` (IPL-style).
- 6 teams (Thunder Wolves, Mystic Mavericks, Crimson Crusaders, Emerald Eagles, Cobalt Sharks, Golden Gladiators).
- 42 players, 7 per team. 1 Cat 1 + 1 Cat 3 + 5 Cat 2 per team so the special-over rules are exercisable.
- Single round-robin = C(6,2) = 15 group matches over 2026-05-20 / 21.
- Playoff bracket (Q1 / Eliminator / Q2 / Final) auto-schedules via `maybeAutoSchedulePlayoffs` once every group match goes terminal.

Creates the tournament row too (status `draft`). Run:

```
pnpm exec supabase link --project-ref clqdimzthzcpurtwhtej
pnpm exec supabase db query --linked --file scripts/seed-pranavs-tournament.sql
```

One-shot — re-runs fail on the unique slug constraint. Targets dev only. Same shape as the existing `seed-appis-tournament.sql` but at a larger team count so points-table + NRR tie-breaks get more variety during testing.

### Team squad page: category chip after each name

`src/app/tournaments/[slug]/teams/[teamId]/page.tsx`. Squad list shows a coloured `C1` / `C2` / `C3` chip after every roster name (amber / muted / sky — same palette as scoring + stats). Organisers can scan a squad before a tournament starts and verify the special-category players are tagged correctly.

### Wicket modal: fielder mandatory for caught / run-out / stumped

`src/app/matches/[matchId]/score/wicket-button.tsx` + `actions.ts`. Save button now toasts "Pick the fielder…" (or "Pick the wicket-keeper" for stumped) when the picker is empty for `caught` / `run_out` / `stumped`. Same constraint enforced server-side via a Zod `.refine()` on `recordBallSchema` so an older or tampered client can't slip through. `caught_and_bowled` unaffected (bowler is the implicit fielder). Stops the commentary feed from reading "WICKET! X caught by ? off Y" and stops the wicket dropping from Most Catches / Run-outs / Stumpings.

### New / changed files

```
src/app/matches/[matchId]/page.tsx                        (Start scoring CTA card)
src/app/matches/[matchId]/score/page.tsx                  (inline TossForm + XISection block)
src/app/matches/[matchId]/toss-form.tsx                   (auto-save; summary + Edit toggle)
src/app/matches/[matchId]/xi/[teamId]/pick-xi-form.tsx    (slim columns; router.back() on save)
src/app/matches/[matchId]/xi/[teamId]/page.tsx            (header copy; whitespace fix)
src/app/matches/[matchId]/score/wicket-button.tsx         (mandatory fielder guard)
src/app/matches/[matchId]/score/actions.ts                (.refine() on recordBallSchema)

src/app/tournaments/[slug]/points-table-section.tsx       (FK pin; Team column width)
src/app/tournaments/[slug]/tournament-champion.tsx        (FK pin on tie-break chain)
src/app/tournaments/[slug]/teams/[teamId]/page.tsx        (category chip per roster row)
src/lib/standings.ts                                       (FK pin)

scripts/seed-pranavs-tournament.sql                       (new — 6-team IPL-format tournament for dev)
```

---

## 20. Sticky CTA + Innings-1 pending-finalize gate + Cat auto-pick (2026-05-17 late, batch 2)

Three small ones that landed after §19. Two are Sudharshan's, one is mine.

### Sticky-bottom Start scoring CTA

`src/app/matches/[matchId]/page.tsx`. The earlier fix in §19 pulled "Start scoring" out of the Activity/Edit row and rendered it as an inline card below the header — fixed the tab-strip confusion but the scorer still had to scroll back up to tap it after reading Details / Toss / Squad on a long match page.

Now for `status='scheduled'` the CTA renders as a viewport-pinned bar at the bottom. Backdrop-blurred (`bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur`), inner content clamps to `max-w-3xl` so it lines up with the page on desktop, `pb-[env(safe-area-inset-bottom)]` so iOS doesn't tuck it under the home indicator. The scrolling container picks up `pb-24 sm:pb-28` only when the bar renders, so the last content card isn't hidden behind the bar.

Live / innings_break unaffected — those still surface the compact "Score" button in the header row, since the match is clearly already running.

### Innings-1 pending-finalize gate — Sudharshan

`commit df6db21`. Files: `src/app/matches/[matchId]/score/{actions.ts, innings-finish-panel.tsx (new), page.tsx, state.ts}`.

When the last ball of innings 1 lands, `recordBall` used to immediately stamp `innings.ended_at` and flip the phase to `innings_break`. The match-complete escape hatch already existed for innings 2 — same pattern now applies at innings break:

- `recordBall` flags `is_complete=true` but leaves `ended_at` null at the natural end of innings 1.
- New phase `innings_1_pending_finish` surfaces an **`InningsFinishPanel`** with **Finish innings** + **Undo last ball** controls.
- `finalizeInnings` (new server action) stamps `ended_at` on confirm and transitions to `innings_break`.
- `voidLastBall` clears both `is_complete` and `ended_at` (existing behaviour) so the scoreboard re-opens cleanly on undo.

Existing in-flight matches aren't affected: in-progress innings have `is_complete=false`, and matches past innings 1 already have `ended_at` set which skips the new gate. Innings 2 / super-over still stamp `ended_at` immediately and gate on `match.status` (covered by the existing MatchCompletePanel).

### Cat-matching auto-pick on category change — Sudharshan

`commit e20febd`. Files: `src/app/matches/[matchId]/score/scoreboard.tsx`.

When the over-Category dropdown switches to **Cat 1** or **Cat 3**, the striker and bowler slot tiles now auto-fill with an eligible player of that category:
- **Striker** — first non-dismissed batting-XI member of the target category (excluding whoever's already on the non-striker slot).
- **Bowler** — first bowling-XI member of the target category not currently in `disabledBowlerIds` (i.e. not the previous-over bowler).

Saves the taps every over boundary when the default Cat 1/3 restriction kicks in — previously the scorer had to manually pick from the (now-filtered) picker even though only one or two players actually qualified.

Fires on manual dropdown changes too. Cat 2 is "any", so it's a no-op.

### New / changed files

```
src/app/matches/[matchId]/page.tsx                            (sticky CTA bar)

src/app/matches/[matchId]/score/innings-finish-panel.tsx      (new — Finish innings + Undo)
src/app/matches/[matchId]/score/actions.ts                    (finalizeInnings action; recordBall leaves ended_at null at end-of-innings-1)
src/app/matches/[matchId]/score/page.tsx                      (innings_1_pending_finish phase mount)
src/app/matches/[matchId]/score/state.ts                      (new phase derivation)

src/app/matches/[matchId]/score/scoreboard.tsx                (Cat 1/3 auto-pick on dropdown change)
```

---

*End of handoff. Good luck.*
