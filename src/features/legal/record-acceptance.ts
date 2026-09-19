/**
 * Records a legal acceptance on the backend (legal-compliance change — U4).
 *
 * Calls the PostgreSQL function `record_legal_acceptance(p_document text,
 * p_version text)` created by migration 0038 (U1). The function is SECURITY
 * DEFINER: it inserts the acceptance row with the caller's `user_id` and an
 * authenticated-only RLS policy — so the client never supplies its own id
 * (no cross-user forgery possible even from a compromised client).
 *
 * Unconfigured builds fail closed WITHOUT hitting the network: the RPC would
 * only 4xx/5xx against a placeholder domain, so the caller gets the same
 * user-safe message immediately. The consent harness pins all three branches
 * (success, rpc error, unconfigured) against the supabase stub (U4 section 4).
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { LegalDocument } from '@/lib/legal-urls';

/** User-safe message surfaced by the gate when recording fails. */
export const ACCEPTANCE_WRITE_ERROR_MESSAGE =
  'We could not record your legal acceptance. Please try again.';

export type RecordAcceptanceResult =
  | { status: 'ok' }
  | { status: 'error'; message: string };

export async function recordAcceptance(
  document: LegalDocument,
  version: string,
): Promise<RecordAcceptanceResult> {
  if (!isSupabaseConfigured) {
    return { status: 'error', message: ACCEPTANCE_WRITE_ERROR_MESSAGE };
  }

  const { error } = await supabase.rpc('record_legal_acceptance', {
    p_document: document,
    p_version: version,
  });

  if (error) {
    console.warn(
      `[legal] record_legal_acceptance failed for ${document}@${version}:`,
      error.message,
    );
    return { status: 'error', message: ACCEPTANCE_WRITE_ERROR_MESSAGE };
  }

  return { status: 'ok' };
}