/**
 * Session-derived selector for feature hooks (ADR-5).
 *
 * Feature APIs call `useAuthMode()` to identify the session owner for
 * authenticated Supabase reads. Session presence in `useSessionStore` is the
 * single source of truth (scope amendment 2026-08-03) — the hook only exposes
 * the signed-in user's id, so hooks can never mix fabricated data with real
 * rows.
 */
import { useSessionStore } from './use-session-store';

export interface AuthModeValue {
  /** The signed-in user's id, or null when there is no session. */
  userId: string | null;
}

export function useAuthMode(): AuthModeValue {
  const session = useSessionStore((s) => s.session);
  return { userId: session?.user.id ?? null };
}
