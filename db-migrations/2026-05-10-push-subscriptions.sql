-- =====================================================================
-- 2026-05-10 — Add push_subscriptions table for per-match push opt-in
-- ---------------------------------------------------------------------
-- Apply via Supabase Dashboard → SQL Editor → New Query → paste → Run.
-- Idempotent (uses IF NOT EXISTS / IF EXISTS guards), so re-running is
-- safe.
-- =====================================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (match_id, endpoint)
);

create index if not exists idx_push_subs_by_match
  on push_subscriptions(match_id);

alter table push_subscriptions enable row level security;
-- No policies → only the service role can read/write.
