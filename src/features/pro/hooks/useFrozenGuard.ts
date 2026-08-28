/**
 * `useFrozenGuard` — intercept-based frozen-state write guard
 * (subscription-trial spec — REQ-FROZEN-1).
 *
 * Instead of overlaying entire screens, this hook intercepts individual
 * write actions: if the user's trial is expired, the action is blocked
 * and a centered dialog offers an upgrade CTA. Reads remain unaffected.
 *
 * Usage:
 *   const { guard, isFrozen } = useFrozenGuard();
 *   guard(() => router.push('/ticket/camera'));
 *   // or guard(async () => { await save(...) });
 */
import { useCallback } from 'react';
import { useRouter } from 'expo-router';

import { useDialogStore } from '@/stores/use-dialog-store';

import { useProEntitlement } from './useProEntitlement';

export interface FrozenGuardResult {
  /** True when the user's trial is expired and writes are blocked. */
  isFrozen: boolean;
  /**
   * Wraps a write action: when frozen, shows an upgrade dialog and does
   * NOT call the action. When not frozen, calls the action immediately.
   * Supports both sync and async callbacks.
   */
  guard: <T>(action: () => T | Promise<T>) => T | Promise<T> | undefined;
}

const FROZEN_TITLE = 'Prueba expirada';
const FROZEN_MESSAGE =
  'Suscribite a PRO para continuar usando esta función.';

export function useFrozenGuard(): FrozenGuardResult {
  const { isFrozen } = useProEntitlement();
  const router = useRouter();

  const guard = useCallback(
    <T>(action: () => T | Promise<T>): T | Promise<T> | undefined => {
      if (isFrozen) {
        useDialogStore.getState().show({
          title: FROZEN_TITLE,
          message: FROZEN_MESSAGE,
          primaryLabel: 'Ver planes',
          onPrimary: () => router.push('/pro'),
          secondaryLabel: 'Cancelar',
        });
        return undefined;
      }
      return action();
    },
    [isFrozen, router],
  );

  return { isFrozen, guard };
}
