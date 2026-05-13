-- =====================================================================
-- 2026-05-13 — Generic audit table for match-level admin events
-- ---------------------------------------------------------------------
-- The `balls` table already records who scored / voided each ball via
-- `scored_by` / `voided_by`. This adds a sibling log for the OTHER
-- admin actions on a match: toss, XI changes, match start, innings
-- transitions, match completion, POTM picks. The activity page
-- merges both streams into one chronological view.
--
-- Schema is intentionally generic — `event_type` is a free text label
-- and `payload` is a JSONB blob the writer fills with whatever extra
-- context is useful. No DB-side enum; the application is the source
-- of truth on the event-type vocabulary.
--
-- RLS denies all so only the service-role admin client can read or
-- write. Server Actions log via the admin client (writes are already
-- guarded by `requireTournamentAdmin`); the activity page reads via
-- the admin client (page is also gated by `requireTournamentAdmin`).
-- =====================================================================

create table if not exists match_audit_events (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references matches(id) on delete cascade,
  event_type  text not null,
  actor_id    uuid references auth.users(id) on delete set null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_match_audit_match_created
  on match_audit_events(match_id, created_at desc);

alter table match_audit_events enable row level security;
-- No policies → only the service role can read or write.
