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
import { useTranslation } from 'react-i18next';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';

import {
  isConsentComplete,
  type LegalAcceptanceRow,
  type LegalConsentStatus,
} from './legal-consent';
import { LATEST_LEGAL_VERSIONS } from './legal-versions';
import { recordAcceptance } from './record-acceptance';

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
  /** True if the last accept() write failed (caller renders via i18n). */
  isError: boolean;
}

export function useLegalConsent(userId: string): UseLegalConsentResult {
  const queryClient = useQueryClient();
  // Errors render via `legal:acceptanceErrorMessage` (was hardcoded English
  // in a constant before — see PR fix). The boolean here is the source of
  // truth; the i18n lookup is the caller's responsibility.
  void useTranslation('legal'); // ensure the namespace is loaded so t() works

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
      if (results.some((r) => r.status === 'error')) {
        throw new Error('recording failed');
      }
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
    isError: acceptMutation.isError,
  };
}