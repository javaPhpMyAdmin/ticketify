import { router } from 'expo-router';
import { useCallback } from 'react';

import { useSessionStore, useSessionUser } from '@/features/auth';
import {
  getFastPathVerdict,
  reconcileEntitlementFromDB,
} from '@/features/pro/entitlement-reconcile';
import { formatQuotaRenewalLabel } from '@/lib/format';
import { queryClient } from '@/lib/query-client';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import { withTimeout } from '@/lib/with-timeout';
import { useDialogStore } from '@/stores/use-dialog-store';

import { computeQuotaState } from '../quota';
import { useScanQuota } from './useScanQuota';

/** Same 2.5s tap bound as the entitlement reconciliation above. */
const SCAN_USAGE_REFETCH_TIMEOUT_MS = 2_500;

/**
 * Shared entry gate for BOTH scan-creation paths: the camera FAB and the
 * manual-entry FAB. A free user at the monthly cap must not reach either
 * screen; instead the quota dialog points at the Pro paywall. Keeping the
 * decision in one hook stops the two FABs from drifting apart.
 *
 * The hook uses the freshest DB verdict BEFORE computing quota: `isPro` from
 * `useScanQuota()` may be a stale cached RevenueCat value for minutes after a
 * webhook revocation, so the user must be blocked at entry, not after taking
 * the photo. The fast path (fresh verdict) avoids network waits: the tap
 * settles from a local DB verdict and reconciliation continues in the
 * background for the next tap. The cold path (no verdict, stale verdict, or a
 * pending listener revoke) may await up to two bounded 2.5s waits sequentially:
 * entitlement reconciliation, then scan-usage refetch. That is ~5s worst case,
 * but both waits are bounded and the decision is made from authoritative state.
 *
 * `Promise.race` timeouts do not cancel the underlying queries, so background
 * refreshes may outlive the tap. The gate bounds each awaited wait separately;
 * it does not make background work cancellable.
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
    const isCurrent = () =>
      useSessionStore.getState().session?.user.id === userId;

    // A fresh DB verdict (plus any 60s listener grant) settles this tap with
    // NO network wait. `getFastPathVerdict` returns null when the verdict is
    // absent/stale or a listener revoke is pending — those cases force a real
    // DB check instead of trusting a possibly stale snapshot.
    const fastPath = userId ? getFastPathVerdict(userId) : null;
    const reconciledIsPro = fastPath
      ? fastPath.isPro
      : userId
        ? await reconcileEntitlementFromDB(userId, isCurrent)
        : isPro;

    // Refresh the verdict for the NEXT tap without making this one wait.
    // The cold path above may have awaited reconciliation already; this is the
    // fast-path background refresh only.
    if (userId && fastPath) {
      void reconcileEntitlementFromDB(userId, isCurrent);
    }

    let used = usage?.used ?? null;
    let limit = usage?.limit ?? null;
    if (used === null && !reconciledIsPro && userId) {
      const key = queryKeys.scanUsage(userId, utcYearMonth());
      // A hung usage fetch must not defeat the tap guarantee. On timeout the
      // value already in the cache (possibly null) is used as-is.
      await withTimeout(
        queryClient.refetchQueries({ queryKey: key }),
        SCAN_USAGE_REFETCH_TIMEOUT_MS,
        undefined,
      );
      const fresh = queryClient.getQueryData<{
        scans_used: number;
        scans_limit: number | null;
      }>(key);
      used = fresh?.scans_used ?? null;
      limit = fresh?.scans_limit ?? null;
    }
    if (used !== null) {
      const state = computeQuotaState(used, limit, reconciledIsPro);
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
