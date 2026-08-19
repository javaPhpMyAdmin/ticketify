/**
 * Render-time Pro route guard (pro-subscription spec — REQ-GATE-3,
 * REQ-GATE-5, subscription-trial — frozen state).
 *
 * Per reviewer S5, the guard is a render-time component mounted INSIDE
 * the screen — NOT a Stack.Screen wrapper. A Stack.Screen wrapper
 * would force every Pro route to share the same auth gate (the parent
 * Stack.Protected session guard already covers signed-in access), and
 * it would split the gate logic away from the screen it protects.
 * Mounting inside the screen keeps the locked/unlocked/frozen decision
 * local to the content and lets the screen keep its own layout (header,
 * back button, ScrollView).
 *
 * The guard reads `useProEntitlement()` and projects through
 * `resolveGateState` (the pure gate). While the state is `'locked'`
 * — either because the bootstrap is still loading or because the user
 * is genuinely free — it renders `<ProLock />`. When the state is
 * `'frozen'`, it renders a frozen-specific lock with upgrade CTA. When
 * the state flips to `'unlocked'` it renders `children` instead, so a
 * successful purchase / restore re-renders the screen with the real
 * content without remounting the route.
 */
import type { ReactElement, ReactNode } from 'react';

import { ProLock } from './components/ProLock';
import { resolveGateState } from './gate';
import { useProEntitlement } from './hooks/useProEntitlement';

export interface ProRouteGuardProps {
  children: ReactNode;
  /** Optional overrides for the lock affordance. */
  lockIcon?: Parameters<typeof ProLock>[0]['icon'];
  lockTitle?: string;
  lockBody?: string;
  lockActionLabel?: string;
}

/**
 * Wraps Pro-only screen content. While the entitlement is `'locked'`
 * (loading or free), renders `<ProLock />`. When `'frozen'` (expired
 * trial), renders a frozen-variant lock. Once the user becomes Pro,
 * renders `children` in place. The route is still mounted in all
 * states — the children are simply not rendered while locked/frozen —
 * so navigation history is preserved and a successful purchase animates
 * the content into view without re-entering the screen.
 */
export function ProRouteGuard({
  children,
  lockIcon,
  lockTitle,
  lockBody,
  lockActionLabel,
}: ProRouteGuardProps): ReactElement {
  const { isPro, isLoading, isFrozen } = useProEntitlement();
  const state = resolveGateState(isPro, isFrozen, isLoading);
  if (state === 'frozen') {
    return (
      <ProLock
        icon="clock.fill"
        title="Tu prueba gratuita expiró"
        body="Suscribite a PRO para seguir usando analytics, presupuestos y más"
        actionLabel="Ver planes"
      />
    );
  }
  if (state === 'locked') {
    return (
      <ProLock
        {...(lockIcon !== undefined ? { icon: lockIcon } : {})}
        {...(lockTitle !== undefined ? { title: lockTitle } : {})}
        {...(lockBody !== undefined ? { body: lockBody } : {})}
        {...(lockActionLabel !== undefined ? { actionLabel: lockActionLabel } : {})}
      />
    );
  }
  return <>{children}</>;
}
