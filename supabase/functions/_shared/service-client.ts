// supabase/functions/_shared/service-client.ts
//
// Shared service-role Supabase client factory for all edge functions
// that need to bypass RLS (RPC orchestration, ledger writes, webhook
// ingestion). DRY refactor extracted from `revenuecat-webhook/index.ts`
// (PR2 WU-2.1 of the `delete-account` change). The single invariant
// the call sites depend on is `auth.persistSession: false` — the
// service-role key MUST NOT be persisted to any storage (it would
// outlive the function's lifetime and create a credential leak across
// cold starts).
//
// Env vars (platform-provided on every Supabase edge function):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//
// Callers can override either URL or key by passing the argument
// explicitly (used by tests that inject a local stack URL).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a service-role Supabase client. The service role bypasses
 * RLS and is meant for server-side orchestration ONLY — never call
 * this from a context that has a user JWT (use the user's client
 * instead, so RLS stays the source of truth for what they can read).
 */
export function serviceClient(
  url: string = Deno.env.get('SUPABASE_URL') ?? '',
  key: string = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false } });
}
