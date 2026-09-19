/**
 * Consent-gate data hook (legal-compliance change — U4).
 *
 * Derives the gate status from the user's `legal_acceptances` rows through
 * TanStack Query (key `queryKeys.legal(userId)`), and exposes `accept()` —
 * the pair of `record_legal_acceptance` RPC writes for PRIVACY + TERMS at
 * the LATEST version, followed by a cache invalidation so the gate re-reads
 * the freshly written rows.
 *
 * Fail-closed posture (design R-5): a failed read resolves to `gated`, never
 * `complete` — consent is never assumed from missing data. The read is
 * disabled until a userId exists (mirrors `useProfile`), so no request runs
 * without a session.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';

import {
  isConsentComplete,
  type LegalAcceptanceRow,
  type LegalConsentStatus,
} from './legal-consent';
import { LATEST_LEGAL_VERSIONS } from './legal-versions';
import { ACCEPTANCE_WRITE_ERROR_MESSAGE, recordAcceptance } from './record-acceptance';

async function readLegalAcceptances(userId: string): Promise<LegalAcceptanceRow[]> {
  if (!isSupabaseConfigured) {
    // Unconfigured dev build: no rows can exist; consent is NOT assumed.
    return [];
  }
  const { data, error } = await supabase
    .from('legal_acceptances')
    .select('document, version')
    .eq('user_id', userId);
  if (error) {
    console.warn('[legal] read legal acceptances failed:', error.message);
    return []; // Fail closed: treat as gated (R-5).
  }
  return (data ?? []) as LegalAcceptanceRow[];
}

export interface UseLegalConsentResult {
  status: LegalConsentStatus;
  /** Records both acceptances at the LATEST versions, then re-reads. */
  accept: () => Promise<void>;
  isAccepting: boolean;
  /** User-safe message when the last accept() write failed. */
  error: string | null;
}

export function useLegalConsent(userId: string): UseLegalConsentResult {
  const queryClient = useQueryClient();

  const acceptancesQuery = useQuery({
    queryKey: queryKeys.legal(userId),
    enabled: !!userId,
    queryFn: () => readLegalAcceptances(userId),
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.all([
        recordAcceptance('privacy', LATEST_LEGAL_VERSIONS.privacy),
        recordAcceptance('terms', LATEST_LEGAL_VERSIONS.terms),
      ]);
      const failed = results.find((result) => result.status === 'error');
      if (failed) throw new Error(failed.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.legal(userId) });
    },
  });

  const status: LegalConsentStatus = acceptancesQuery.isLoading
    ? 'loading'
    : isConsentComplete(acceptancesQuery.data ?? [])
      ? 'complete'
      : 'gated';

  return {
    status,
    accept: () => acceptMutation.mutateAsync(),
    isAccepting: acceptMutation.isPending,
    error: acceptMutation.isError
      ? (acceptMutation.error instanceof Error
          ? acceptMutation.error.message
          : ACCEPTANCE_WRITE_ERROR_MESSAGE)
      : null,
  };
}