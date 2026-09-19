/**
 * Device-side pending-acceptance flag (legal-compliance change — U4).
 *
 * Written atomically at sign-up BEFORE `signUpWithEmail` (a consent given is
 * never lost to a network failure) and flushed on the next signed-in session
 * beside `ensureProfile`. Storage rides the SAME chunked SecureStore adapter
 * the auth session uses — one storage backend, no new native dependency —
 * under a `[A-Za-z0-9._-]`-safe key.
 *
 * Safety (design U5): `flushPendingAcceptance` only records acceptances when
 * `flushDecision` says the flag belongs to the CURRENT email at a CURRENT
 * version. A stale flag is cleared without writing; a failed write KEEPS the
 * flag so the intent survives to the next session (fire-and-forget semantics
 * — the session-store handler never awaits it).
 */
import { secureStoreAdapter, type StorageAdapter } from '@/lib/supabase/storage-adapter';

import {
  flushDecision,
  type PendingAcceptanceFlag,
} from './legal-consent';
import { LATEST_LEGAL_VERSIONS } from './legal-versions';
import { recordAcceptance } from './record-acceptance';

/** SecureStore-safe key (charset `[A-Za-z0-9._-]`). */
export const PENDING_ACCEPTANCE_KEY = 'legal.pending-acceptance';

/**
 * Parse + validate a stored flag. Corrupt or malformed payloads resolve to
 * null (treated as absent) so a torn write can never block the app — the
 * worst case is a lost pending flag, never a crash or a stuck gate.
 */
function parseFlag(raw: string | null): PendingAcceptanceFlag | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed != null &&
      typeof (parsed as PendingAcceptanceFlag).email === 'string' &&
      (parsed as PendingAcceptanceFlag).email.length > 0 &&
      typeof (parsed as PendingAcceptanceFlag).version === 'string' &&
      (parsed as PendingAcceptanceFlag).version.length > 0 &&
      typeof (parsed as PendingAcceptanceFlag).acceptedAt === 'string' &&
      (parsed as PendingAcceptanceFlag).acceptedAt.length > 0
    ) {
      return parsed as PendingAcceptanceFlag;
    }
  } catch {
    // Corrupt payload — treat as absent.
  }
  return null;
}

export interface PendingAcceptanceStore {
  read(): Promise<PendingAcceptanceFlag | null>;
  write(flag: PendingAcceptanceFlag): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Factory over any `StorageAdapter` — the app uses the SecureStore-backed
 * singleton below; the harness injects an in-memory adapter (U4 section 3).
 */
export function createPendingAcceptanceStore(
  adapter: StorageAdapter,
): PendingAcceptanceStore {
  return {
    read: async () => parseFlag(await adapter.getItem(PENDING_ACCEPTANCE_KEY)),
    write: async (flag) => {
      await adapter.setItem(PENDING_ACCEPTANCE_KEY, JSON.stringify(flag));
    },
    clear: async () => {
      await adapter.removeItem(PENDING_ACCEPTANCE_KEY);
    },
  };
}

/** The app-wide store, backed by the chunked SecureStore adapter. */
export const pendingAcceptanceStore = createPendingAcceptanceStore(secureStoreAdapter);

/**
 * Resolve a pending acceptance flag for the CURRENT signed-in email.
 * Callers treat it as fire-and-forget (`void flushPendingAcceptance(email)`):
 *  - no flag → no-op;
 *  - stale (wrong email or superseded version) → cleared, never written;
 *  - current → both documents recorded (v2 of the RPC), then cleared;
 *    a failed write keeps the flag for the next session.
 */
export async function flushPendingAcceptance(userEmail: string): Promise<void> {
  const flag = await pendingAcceptanceStore.read();
  if (flag == null) return;

  if (flushDecision(flag, userEmail) === 'clear-stale') {
    await pendingAcceptanceStore.clear();
    return;
  }

  const results = await Promise.all([
    recordAcceptance('privacy', LATEST_LEGAL_VERSIONS.privacy),
    recordAcceptance('terms', LATEST_LEGAL_VERSIONS.terms),
  ]);
  if (results.every((result) => result.status === 'ok')) {
    await pendingAcceptanceStore.clear();
  }
  // Any failure keeps the flag so the next signed-in session retries —
  // the acceptance intent is never silently dropped (R-5).
}