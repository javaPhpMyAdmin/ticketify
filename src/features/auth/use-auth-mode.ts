/**
 * Mode-aware selector for feature hooks (ADR-4).
 *
 * Feature APIs call `useAuthMode()` BEFORE any network request: `mode`
 * decides between Supabase reads and demo fixtures, `userId` identifies the
 * session owner. Deriving both here — from the settings store (mode) and the
 * session store (user id) — keeps a single source of truth and guarantees
 * hooks never mix fixtures with real data.
 */
import { useSessionStore } from './use-session-store';
import { useSettingsStore } from '@/stores/use-settings-store';

// Re-exported for callers that want the type without importing the store.
export type { AuthMode } from '@/stores/use-settings-store';

export interface AuthModeValue {
  /** Data source: 'demo' (fixtures) or 'authenticated' (Supabase). */
  mode: 'demo' | 'authenticated';
  /** The signed-in user's id, or null when there is no session. */
  userId: string | null;
}

export function useAuthMode(): AuthModeValue {
  const mode = useSettingsStore((s) => s.mode);
  const session = useSessionStore((s) => s.session);
  return { mode, userId: session?.user.id ?? null };
}
