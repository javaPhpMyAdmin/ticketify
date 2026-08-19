/**
 * Pro feature barrel.
 *
 *   import { ProRouteGuard, useProEntitlement, resolveGateState } from '@/features/pro';
 */
export { ProRouteGuard } from './ProRouteGuard';
export type { ProRouteGuardProps } from './ProRouteGuard';

export { ProLock } from './components/ProLock';
export type { ProLockProps } from './components/ProLock';

export { TrialBanner } from './components/TrialBanner';

export { useProEntitlement } from './hooks/useProEntitlement';
export type { ProEntitlement } from './hooks/useProEntitlement';

export { useFrozenGuard } from './hooks/useFrozenGuard';
export type { FrozenGuardResult } from './hooks/useFrozenGuard';

export { resolveGateState, isProOverrideEnabled } from './gate';
export type { GateState } from './gate';

export { ProBootstrap } from './pro-bootstrap';
