/**
 * Pro entitlement store (pro-subscription spec — REQ-PRO-1, REQ-GATE-5).
 *
 * The single source of truth for the client's "is Pro" state. The
 * bootstrap (`src/features/pro/pro-bootstrap.tsx`) calls `revenuecat.configure`
 * and pipes the resulting `CustomerInfo` through `setPro`. The
 * `useProEntitlement` hook (`src/features/pro/hooks/useProEntitlement.ts`)
 * is the only consumer that should matter to screens: every gate reads
 * `isPro` and `isLoading` through it.
 *
 * Initial state is `{ isPro: false, isLoading: true }`. The gate
 * (`src/features/pro/gate.ts`) treats `isLoading === true` as
 * `'locked'`, so pro content never flashes unlocked while the SDK
 * configuration is still in flight — REQ-GATE-5.
 */
import { create } from 'zustand';

import { getCustomerInfo, type CustomerInfoSnapshot } from '@/lib/revenuecat';

export interface ProState {
  /** True when the signed-in user holds the `pro` entitlement. */
  isPro: boolean;
  /**
   * True while the bootstrap is fetching `CustomerInfo`. Starts as `true`
   * so a fresh mount of the gate defaults to `locked` — REQ-GATE-5.
   */
  isLoading: boolean;
  /** Re-reads `CustomerInfo` from the SDK and updates `isPro`. */
  refresh: () => Promise<void>;
  /** Direct setter for the SDK's `customerInfoUpdate` listener (M5+). */
  setPro: (isPro: boolean) => void;
}

export const useProStore = create<ProState>((set) => ({
  isPro: false,
  // REQ-GATE-5: gate stays locked until the SDK configuration resolves.
  // Bootstrap clears this when `CustomerInfo` arrives (or when the SDK
  // is unavailable and we settle on the safe default).
  isLoading: true,

  refresh: async () => {
    const info: CustomerInfoSnapshot | null = await getCustomerInfo();
    set({ isPro: info?.isPro ?? false, isLoading: false });
  },

  setPro: (isPro) => set({ isPro }),
}));
