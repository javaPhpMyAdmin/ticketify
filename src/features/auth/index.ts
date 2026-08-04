/**
 * Auth feature barrel.
 *
 *   import { useSessionUser, useSessionStore } from '@/features/auth';
 */
export { useSessionUser } from './use-session-user';
export type { SessionUserValue } from './use-session-user';

export { useSessionStore } from './use-session-store';
export type {
  AuthActionError,
  SignUpResult,
} from './use-session-store';
