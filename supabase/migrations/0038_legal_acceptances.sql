-- ============================================================================
-- 0038_legal_acceptances.sql
-- Ticketify — versioned legal acceptances (append-only audit trail).
--
-- Change: legal-compliance  (SDD change id)
-- Phase:  U1 (DB + config slice: migration + smoke + registries)
-- Cross-refs: legal-consent REQ-1 (acceptance record — append-only table,
--             PK (user_id, document, version), document CHECK limited to
--             'privacy'|'terms', RLS select/insert own only, SECURITY
--             DEFINER RPC as the canonical writer), design AD-3 (RLS
--             select/insert own + RPC for idempotency), AD-4 (version is an
--             ISO date string shared by both documents), and the NFR
--             Security privilege boundary (EXECUTE only to authenticated —
--             the callers derive user_id from auth.uid()). See
--             openspec/changes/legal-compliance/design.md and
--             openspec/changes/legal-compliance/specs/legal-consent/spec.md.
--
-- Compliance driver: Google Play user-data policy / account deletion
-- requirements — a versioned, auditable record that the user accepted the
-- current Privacy Policy and Terms.
--
-- What this migration does
-- ------------------------
--   §1. Table. `public.legal_acceptances` stores one row per accepted
--       (document, version) per user:
--
--         user_id     uuid        NOT NULL → auth.users(id) ON DELETE CASCADE
--         document    text        NOT NULL  CHECK (document in ('privacy','terms'))
--         version     text        NOT NULL  (ISO date string, e.g. '2026-09-18')
--         accepted_at timestamptz NOT NULL  DEFAULT now()
--         PRIMARY KEY (user_id, document, version)
--
--       The PK makes re-acceptance at a NEW version a fresh row while a
--       duplicate (document, version) collapses to a no-op; version bumps
--       re-gate users whose latest acceptance is older (legal-consent
--       REQ-2) without ever rewriting history.
--
--   §2. RLS. Enabled with EXACTLY two policies — select_own (using
--       auth.uid() = user_id) and insert_own (with check auth.uid() =
--       user_id). There is NO update or delete policy: acceptances are
--       immutable customer-facing audit data (REQ-1 "no update/delete
--       policies"). Rows are only ever added, never altered or removed by
--       clients; they die with the account via the auth.users cascade.
--
--   §3. RPC. `public.record_legal_acceptance(p_document text, p_version
--       text)` returns void, is SECURITY DEFINER with the definer pinned
--       to `postgres`, and is the canonical writer: it derives user_id
--       from auth.uid() (clients can never choose the row owner) and is
--       idempotent for duplicate (document, version) pairs via `on
--       conflict do nothing` (REQ-1 duplicate record scenario).
--
--       Grants follow 0036 exactly — explicit REVOKE from PUBLIC/anon/
--       service_role (Postgres grants EXECUTE to PUBLIC by default for
--       every new function; without the REVOKE this SECURITY DEFINER RPC
--       would be a public oracle — the 0029 §4 trap) — and LEAST PRIVILEGE
--       grant to `authenticated` ONLY. Unlike 0036 (service_role only),
--       this RPC has no user-id parameter: the caller IS the owner, so the
--       app session (authenticated) is the sole legitimate caller.
--
-- Rollback note
-- -------------
--   The table is append-only audit data. Dropping it in a rollback loses
--   the acceptance trail — prefer a follow-up migration (0039) to `drop
--   function` + `drop table` only after confirming no pending flush UX is
--   in the field, or keep the table and revert the client (design §
--   Rollback Considerations).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1-§2. Table + RLS.
-- ---------------------------------------------------------------------------

create table public.legal_acceptances (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  document    text        not null check (document in ('privacy', 'terms')),
  version     text        not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, document, version)
);

alter table public.legal_acceptances enable row level security;

create policy "legal_acceptances_select_own" on public.legal_acceptances
  for select using (auth.uid() = user_id);

create policy "legal_acceptances_insert_own" on public.legal_acceptances
  for insert with check (auth.uid() = user_id);

-- no update/delete policies: append-only for clients (REQ-1)

-- ---------------------------------------------------------------------------
-- §3. record_legal_acceptance(document, version) — the canonical writer.
-- ---------------------------------------------------------------------------

create or replace function public.record_legal_acceptance(p_document text, p_version text)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  insert into public.legal_acceptances (user_id, document, version)
  values (auth.uid(), p_document, p_version)
  on conflict (user_id, document, version) do nothing;
end;
$$;

-- Pins the definer owner (required for SECURITY DEFINER to run as the
-- superuser that bypasses RLS — same belt-and-braces as 0025, 0031 §2,
-- 0034 §3, 0035 §2, 0036).
alter function public.record_legal_acceptance(text, text) owner to postgres;

-- Least privilege: authenticated ONLY (the caller derives user_id from
-- auth.uid(), so the caller role is the app session).
--
-- Postgres grants EXECUTE to PUBLIC by default for every new function
-- (the 0029 §4 trap). An explicit REVOKE from PUBLIC, anon AND
-- service_role is REQUIRED; otherwise an unauthenticated caller could
-- execute this SECURITY DEFINER RPC as postgres and write arbitrary
-- acceptance rows.
revoke execute on function public.record_legal_acceptance(text, text) from public, anon, service_role;
grant  execute on function public.record_legal_acceptance(text, text) to authenticated;

comment on function public.record_legal_acceptance(p_document text, p_version text) is
  'Records the calling user''s acceptance of a legal document at a given version (user_id derived from auth.uid()). SECURITY DEFINER, owned by postgres, callable by authenticated ONLY. Idempotent: a duplicate (document, version) pair is a no-op (on conflict do nothing). Valid documents: privacy, terms (enforced by the table CHECK). Append-only: no update/delete policies exist on legal_acceptances.';