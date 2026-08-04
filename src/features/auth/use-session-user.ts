/**
 * Session-derived selector for feature hooks (ADR-5).
 *
 * Feature APIs call `useSessionUser()` to identify the signed-in user for
 * authenticated Supabase reads. Session presence in `useSessionStore` is the
 * single source of truth (scope amendment 2026-08-03) — the hook only exposes
 * the signed-in user's id and auth email, so hooks can never mix fabricated
 * data with real rows. The email comes from `auth.users` and is intentionally
 * NOT persisted in `profiles`, so screens that need it read it from the
 * session here.
 */
import { useSessionStore } from './use-session-store';

export interface SessionUserValue {
  /** The signed-in user's id, or null when there is no session. */
  userId: string | null;
  /** The signed-in user's email (auth.users) — not present in profiles. */
  email: string | null;
}

export function useSessionUser(): SessionUserValue {
  const session = useSessionStore((s) => s.session);
  return {
    userId: session?.user.id ?? null,
    email: session?.user.email ?? null,
  };
}
