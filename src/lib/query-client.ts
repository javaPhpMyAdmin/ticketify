/**
 * Module-scope QueryClient singleton (server-state-caching spec — D1, D5).
 *
 * One client app-wide: a single cache/dedupe (Home budget + Profile share the
 * same `profiles` row), a single `clear()` target on SIGNED_OUT, and a single
 * provider site in `src/app/_layout.tsx`. Freshness/retention defaults live
 * here; the scan-usage read overrides staleTime to 30s at its hook.
 *
 * Non-web focus wiring: AppState → `focusManager.setFocused` so returning to
 * the foreground refetches only STALE queries (staleTime is non-zero, so fresh
 * queries skip the network). `setFocused` is idempotent, so a stacked listener
 * is harmless (D5).
 */
import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { shouldRetry } from '@/lib/supabase/query-adapters';

/** Default freshness for profile, budget, and analytics reads (60s). */
export const DEFAULT_STALE_TIME = 60_000;

/** Scan-usage freshness override (fresh-month counters go stale sooner). */
export const SCAN_USAGE_STALE_TIME = 30_000;

/** Retention for every query: evicted after unmount + this long untouched. */
export const QUERY_GC_TIME = 5 * 60_000;

/** The app-wide client. Create and provide it in `src/app/_layout.tsx`. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME,
      gcTime: QUERY_GC_TIME,
      retry: shouldRetry,
      refetchOnWindowFocus: true,
    },
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });
}
