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

// DeleteAccountResult is re-exported from the auth barrel so screens can
// `import type { DeleteAccountResult } from '@/features/auth'` without
// reaching into the supabase feature-access seam directly. The runtime
// import (`deleteAccount`) lives in `@/lib/supabase/feature-access`.
export type { DeleteAccountResult } from '@/lib/supabase/feature-access';
