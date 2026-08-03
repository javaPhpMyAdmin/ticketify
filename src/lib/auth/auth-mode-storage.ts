/**
 * Auth-mode persistence (reliability re-gate, ADR-4/ADR-5).
 *
 * The data-source mode (`'demo' | 'authenticated'`) is the root gate's input
 * at launch: after an explicit sign-out the gate must keep showing the
 * sign-in screen instead of silently opening the demo path, and a valid
 * persisted session must never be dropped into fixtures. The mode is
 * persisted through the same chunked SecureStore adapter as the session, so
 * restore() can reconcile it BEFORE the session read.
 *
 * Only `'authenticated'` is ever written (every session-bearing event
 * promotes the mode); `'demo'` is the implicit default when nothing is
 * persisted, so a fresh install keeps the demo path. Web (no SecureStore
 * backend) and storage failures degrade to "nothing persisted" — the demo
 * default — and persistence failures are swallowed: they must never break an
 * auth transition.
 */
import { secureStoreAdapter } from '@/lib/supabase/storage-adapter';
import type { AuthMode } from '@/stores/use-settings-store';

const MODE_STORAGE_KEY = 'ticketify.auth-mode';

/**
 * The persisted mode, or null when nothing is stored (fresh install) or the
 * backend is unavailable/corrupt (web, storage failure).
 */
export async function loadPersistedAuthMode(): Promise<AuthMode | null> {
  try {
    const raw = await secureStoreAdapter.getItem(MODE_STORAGE_KEY);
    if (raw === 'demo' || raw === 'authenticated') return raw;
    return null;
  } catch {
    // SecureStore unavailable (web) or a backend failure: nothing persisted.
    return null;
  }
}

/** Best-effort persistence; failures never propagate into auth flows. */
export async function savePersistedAuthMode(mode: AuthMode): Promise<void> {
  try {
    await secureStoreAdapter.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Best effort — persistence must never break an auth transition.
  }
}
