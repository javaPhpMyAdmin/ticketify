/**
 * Auth feature barrel.
 *
 *   import { useAuthMode, useSessionStore } from '@/features/auth';
 */
export { useAuthMode } from './use-auth-mode';
export type { AuthModeValue } from './use-auth-mode';
export type { AuthMode } from '@/stores/use-settings-store';

export { useSessionStore } from './use-session-store';
export type {
  AuthActionError,
  SignUpResult,
} from './use-session-store';
