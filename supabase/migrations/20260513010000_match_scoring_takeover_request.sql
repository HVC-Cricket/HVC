-- =====================================================================
-- 2026-05-13 — Permission-based takeover for the scoring lock
-- ---------------------------------------------------------------------
-- Layered onto the lock added in 20260513000000. Instead of any admin
-- being able to force-claim the lock with a single click, a second
-- admin now files a *request* to take over. The current holder gets
-- a banner with Allow / Deny — only "Allow" actually transfers the
-- lock. If the current holder's heartbeat expires (idle 2+ min) the
-- requester can still claim via the regular acquire path; the
-- pending-request slot just makes the active-holder case explicit.
--
-- One pending-request slot per match. Second attempt while one is
-- already pending: refused with "another request is already pending"
-- by the application code.
-- =====================================================================

alter table matches
  add column if not exists pending_scorer_request_id uuid references auth.users(id) on delete set null;

alter table matches
  add column if not exists pending_scorer_request_at timestamptz;

create index if not exists idx_matches_pending_scorer_request
  on matches(pending_scorer_request_id)
  where pending_scorer_request_id is not null;
