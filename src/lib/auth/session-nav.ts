/**
 * Pure decision for the root layout's "go to app" navigation
 * (`src/app/_layout.tsx`), extracted so the auth-gate state machine is
 * unit-testable without expo-router (same harness pattern as
 * `decideOAuthCallbackWait` in `src/lib/auth/oauth.ts`).
 *
 * The gate navigates to `/` when a session is present and the current route
 * is not an auth deep link that owns its own exit:
 *
 * 1. FLIP — the session went from null to a session (`!prevSession`). The
 *    Stack.Protected gate has committed `(tabs)` by the time the caller's
 *    effect runs, so the replace can never race the guard. Covers email
 *    sign-in/sign-up and the OAuth cold-start exchange.
 * 2. PARKED — a session is present while `/oauth` is on screen with no flip
 *    observed (`prevSession` already truthy). Two real cases: the warm race
 *    (Android callback Linking event pushed `/oauth` after the in-process
 *    exchange already set the session) and the stored-session cold start
 *    (the store held a session before the effect ever saw null).
 *
 * Both clauses are suppressed on `/reset-password`: that screen owns its
 * exit (the recovery exchange signs in with a recovery session before the
 * user picks a new password), so the gate must never steal it.
 */
import type { Session } from '@supabase/supabase-js';

export interface SessionNavInput {
  /** The session value from the previous render/effect run. */
  prevSession: Session | null;
  /** The current store session. */
  session: Session | null;
  /** The current expo-router pathname. */
  pathname: string;
}

export interface SessionNavDecision {
  /** True when the caller should navigate to `target`. */
  shouldNavigate: boolean;
  /** The destination; always `/` (the tabs group). */
  target: '/';
}

export function decideSessionNavigation({
  prevSession,
  session,
  pathname,
}: SessionNavInput): SessionNavDecision {
  const flippedToSession = !prevSession && session != null;
  const parkedOnOAuthWithSession = pathname === '/oauth' && session != null;
  const shouldNavigate =
    pathname !== '/reset-password' &&
    (flippedToSession || parkedOnOAuthWithSession);
  return { shouldNavigate, target: '/' };
}
