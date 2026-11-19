import { router } from 'expo-router';
import { useCallback } from 'react';

import { useSessionUser } from '@/features/auth';
import { formatQuotaRenewalLabel } from '@/lib/format';
import { queryClient } from '@/lib/query-client';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import { useDialogStore } from '@/stores/use-dialog-store';

import { computeQuotaState } from '../quota';
import { useScanQuota } from './useScanQuota';

/**
 * Shared entry gate for BOTH scan-creation paths: the camera FAB and the
 * manual-entry FAB. A free user at the monthly cap must not reach either
 * screen; instead the quota dialog points at the Pro paywall. Keeping the
 * decision in one hook stops the two FABs from drifting apart.
 *
 * `scanUsage === null` means the row is still loading — OR a brand-new
 * month with no row yet (scan_usage rows are created on first consume).
 * Never block on unknown state: Pro always passes; free users wait for
 * the pending read and decide once, so an existing at-cap row still
 * blocks while a fresh-month null row lets the entry through. The
 * server-side `save_receipt` gate remains the backstop.
 */
export function useScanQuotaGate(): () => Promise<boolean> {
  const { usage, isPro } = useScanQuota();
  const { userId } = useSessionUser();

  return useCallback(async () => {
    let used = usage?.used ?? null;
    let limit = usage?.limit ?? null;
    if (used === null && !isPro && userId) {
      const key = queryKeys.scanUsage(userId, utcYearMonth());
      await queryClient.refetchQueries({ queryKey: key });
      const fresh = queryClient.getQueryData<{
        scans_used: number;
        scans_limit: number | null;
      }>(key);
      used = fresh?.scans_used ?? null;
      limit = fresh?.scans_limit ?? null;
    }
    if (used !== null) {
      const state = computeQuotaState(used, limit, isPro);
      if (state.exhausted) {
        useDialogStore.getState().show({
          title: 'Alcanzaste el límite gratuito',
          message: `Tu plan gratuito incluye ${state.effectiveLimit} escaneos por mes. Se renueva ${formatQuotaRenewalLabel()}.`,
          primaryLabel: 'Mejorar a Pro',
          onPrimary: () => router.push('/pro'),
          secondaryLabel: 'Ahora no',
        });
        return false;
      }
    }
    return true;
  }, [usage, isPro, userId]);
}
