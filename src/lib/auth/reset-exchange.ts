/**
 * Password-recovery code exchange (reliability re-gate).
 *
 * In auth-js 2.111.0 `exchangeCodeForSession` RESOLVES — it never rejects —
 * when the code is invalid or expired: the failure arrives in the result's
 * `error` field. This helper normalizes that contract so the screen can tell
 * "invalid link" (resolved with an error, or without a session) apart from a
 * thrown storage/network exception, which still propagates to the caller's
 * catch.
 *
 * When the recovery email's link carries `sb_flow_id`, it is passed through so
 * the exchange reads that flow's stored PKCE verifier instead of the shared
 * legacy slot, which any later PKCE flow would have overwritten (intermittent
 * "invalid link" on recovery links otherwise).
 */
import { supabase } from '@/lib/supabase';

export interface RecoveryExchangeResult {
  /** True when the code was exchanged for a session. */
  ok: boolean;
}

export async function exchangeRecoveryCode(
  code: string,
  flowId?: string,
): Promise<RecoveryExchangeResult> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  if (error || !data.session) return { ok: false };
  return { ok: true };
}
