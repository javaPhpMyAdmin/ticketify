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
 * only 4xx/5xx against a placeholder domain, so the caller gets `{ status:
 * 'error' }` immediately. The caller renders the user-safe message via
 * `t('acceptanceErrorMessage')` from the `legal` i18n namespace — the copy
 * is no longer hardcoded here so the user sees their active locale.
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { LegalDocument } from '@/lib/legal-urls';

export type RecordAcceptanceResult =
  | { status: 'ok' }
  | { status: 'error' };

export async function recordAcceptance(
  document: LegalDocument,
  version: string,
): Promise<RecordAcceptanceResult> {
  if (!isSupabaseConfigured) {
    return { status: 'error' };
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
    return { status: 'error' };
  }

  return { status: 'ok' };
}
