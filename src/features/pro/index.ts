/**
 * Pro feature barrel.
 *
 *   import { ProRouteGuard, useProEntitlement, resolveGateState } from '@/features/pro';
 */
export { ProRouteGuard } from './ProRouteGuard';
export type { ProRouteGuardProps } from './ProRouteGuard';

export { ProLock } from './components/ProLock';
export type { ProLockProps } from './components/ProLock';

export { useProEntitlement } from './hooks/useProEntitlement';
export type { ProEntitlement } from './hooks/useProEntitlement';

export { resolveGateState } from './gate';
export type { GateState } from './gate';

export { ProBootstrap } from './pro-bootstrap';
