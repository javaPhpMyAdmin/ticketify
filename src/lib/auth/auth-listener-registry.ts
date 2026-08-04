/**
 * Holds the active auth-state subscription across Fast Refresh.
 *
 * The session store registers its `onAuthStateChange` listener through this
 * registry instead of a module-scope flag. A flag resets when Metro
 * re-executes the store's module in dev, while the PREVIOUS subscription stays
 * registered on the client — every refresh then stacks a duplicate listener
 * that fires the same events twice. This registry lives in its own module, so
 * Fast Refresh preserves its instance: registering again unsubscribes the
 * previous handle before subscribing, keeping exactly one listener even
 * across refreshes.
 *
 * Only the handle is stored here — the listener body and store wiring stay in
 * the session store. The registry imports types only, so it is dependency-free
 * at runtime (and compiles cleanly in the node test harness).
 */
import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
} from '@supabase/supabase-js';

type OnAuthStateChange = SupabaseClient['auth']['onAuthStateChange'];
// auth-js types the callback as returning Promise<void>; the store's handler
// is fire-and-forget, and a void function is assignable to that parameter.
type AuthStateCallback = (event: AuthChangeEvent, session: Session | null) => void;
type AuthStateSubscription = ReturnType<OnAuthStateChange>['data']['subscription'];

let activeSubscription: AuthStateSubscription | null = null;

/**
 * Registers `callback` with the client's `onAuthStateChange`, replacing any
 * previously registered listener. Idempotent within a module instance too:
 * calling it twice subscribes exactly once (the first handle is unsubscribed).
 */
export function registerAuthStateListener(
  onAuthStateChange: OnAuthStateChange,
  callback: AuthStateCallback,
): AuthStateSubscription {
  activeSubscription?.unsubscribe();
  activeSubscription = onAuthStateChange(callback).data.subscription;
  return activeSubscription;
}

/** Unsubscribes and clears the active listener, if any. */
export function unregisterAuthStateListener(): void {
  activeSubscription?.unsubscribe();
  activeSubscription = null;
}
