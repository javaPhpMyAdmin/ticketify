-- ============================================================================
-- Ticketify — pro subscription: webhook event ledger (M1 of the
-- pro-subscription change; WU-M1.2).
--
-- Sibling to `0011_pro_scan_quota_and_tier.sql`. Idempotent with it —
-- the two migrations are sequenced M1.1 → M1.2 because the webhook
-- references both `set_profile_tier` (0011 §3) and this ledger. The
-- migration order is additive: this table is new, no other migration
-- touches it.
--
-- Why this migration exists
-- -------------------------
-- RevenueCat webhooks are at-least-once with retries. The pre-0012
-- contract (REQ-SYNC-6) covered duplicate `event.id` values, but a
-- retried INITIAL_PURCHASE arriving AFTER a later EXPIRATION would
-- replay the grant (`free → pro` after `pro → free`) — a real
-- reordering hazard, not a duplicate hazard. The design (D6 / WARNING-1)
-- extends idempotency to ordering: the webhook must NOT apply an event
-- whose identity is already seen, AND must NOT apply an event older
-- than the last applied one for that user.
--
-- This ledger is the source of truth for "what was applied". The
-- webhook's flow becomes:
--
--   INSERT INTO webhook_events (user_id, event_id, event_ts, event_type)
--     ON CONFLICT DO NOTHING
--     RETURNING applied_at
--   ├─ no row returned  → 200 no-op  (already-seen event_id; REQ-SYNC-6)
--   └─ row returned     → continue
--                        → SELECT max(event_ts) WHERE user_id = …
--                        → event_ts < last_ts → 200 no-op (out-of-order)
--                        → GRANT/REVOKE → svc.rpc('set_profile_tier', …)
--                        → 200 ok
--
-- The INSERT-then-CHECK-then-CALL ordering makes the primary key the
-- race resolver: two concurrent deliveries collide on `(user_id,
-- event_id)`, exactly one wins. The race-loser sees no row returned
-- and stays 200 no-op (REQ-SYNC-6 + WARNING-1).
--
-- What this migration does
-- ------------------------
--   * Table `webhook_events` keyed by (user_id, event_id). FK to
--     profiles(id) ON DELETE CASCADE: a deleted profile removes its
--     ledger rows automatically. `applied_at default now()` so the
--     INSERT does not have to bind a timestamp.
--   * Index `(user_id, event_ts desc)` so the "last applied event_ts"
--     query for the ordering check is index-only.
--   * Table comment pins the contract (REQ-SYNC-6 + WARNING-1) so a
--     future reader knows the WHY without reading design.md.
--   * RLS enabled. authenticated may SELECT its own row only
--     (`auth.uid() = user_id`); no write policy (clients MUST NOT
--     touch the ledger — every INSERT goes through the webhook's
--     service_role client, which bypasses RLS).
--
-- What this migration does NOT do
-- -------------------------------
--   * No retention policy. The ledger grows monotonically. A future
--     maintenance migration (S1) will prune by `event_ts` once the
--     design sets the retention window; until then the table is small
--     (one row per delivered webhook event per user) and the index is
--     cheap.
--   * No application-side changes. The webhook reads/writes through
--     service_role, which bypasses RLS, so the policy is a client-side
--     defense-in-depth guard.
-- ============================================================================

create table public.webhook_events (
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  event_id    text        not null,
  event_ts    timestamptz not null,
  event_type  text        not null,
  applied_at  timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index webhook_events_user_ts_idx
  on public.webhook_events (user_id, event_ts desc);

comment on table public.webhook_events is
  'RevenueCat webhook ledger for idempotency + ordering (REQ-SYNC-6, W2). The webhook inserts ON CONFLICT DO NOTHING; a no-row return = already-seen event_id = 200 no-op. After insert, an event_ts < max(event_ts) for the user = out-of-order = 200 no-op.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.webhook_events enable row level security;

-- Client-side read: a user can see their own ledger entries. Useful for
-- debugging from the app (e.g. "did my subscription event arrive?") and
-- keeps the principle that data scoped to a user is visible to that
-- user. No write policy: every INSERT goes through service_role, which
-- bypasses RLS. anon is intentionally omitted (no policy targets it).
drop policy if exists "webhook_events_select_own" on public.webhook_events;
create policy "webhook_events_select_own" on public.webhook_events
  for select to authenticated
  using (auth.uid() = user_id);
