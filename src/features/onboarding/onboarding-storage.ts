/**
 * Onboarding persistence helper — AsyncStorage-backed flag tracking
 * whether the user has finished the first-launch welcome flow.
 *
 * Lives next to the pure model (`onboarding-model.ts`) so the wizard
 * logic and its persistence concerns live in one feature directory.
 * The root layout (`src/app/_layout.tsx`) reads this flag in the
 * onboarding gate; the screens call `markOnboardingCompleted()` on
 * the final step's CTA before navigating to auth.
 *
 * The flag is written under a versioned key
 * (`onboarding.completed.v1`) so a future migration can bump the
 * version (e.g. `v2`) and invalidate stale writes without touching
 * any call site. Both wrappers collapse a backend rejection to a
 * safe default:
 *
 *   - `getOnboardingCompleted()` on rejection → `false`. A storage
 *     failure must behave like a fresh install (the gate routes to
 *     onboarding), never like a returning user.
 *   - `markOnboardingCompleted()` on rejection → swallowed. A write
 *     failure is non-fatal — the user can still complete the flow
 *     and reach auth; the worst case is the gate shows them the
 *     welcome flow again on the next launch.
 *
 * The `__testing__` factory exposes a tiny DI seam so the harness
 * can inject an in-memory backend without module-mocking the
 * AsyncStorage native module. The production helper uses the real
 * module via `import` at module-load time.
 *
 * The helper is intentionally framework-agnostic (no react-native
 * outside the AsyncStorage import) so it could be lifted to a
 * pre-render path in the future without ripple changes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Versioned key. The `.v1` suffix is the migration guard: a future
 * reset/invalidation flow bumps this string (e.g. `.v2`) and the
 * gate silently treats the absence as `false` on read.
 */
export const ONBOARDING_COMPLETED_KEY = 'onboarding.completed.v1';

/**
 * Minimal AsyncStorage-like contract — the real module from
 * `@react-native-async-storage/async-storage` satisfies this
 * structurally (it implements `getItem`, `setItem`, `removeItem`,
 * all returning promises). The seam exists so the harness injects
 * an in-memory map without module mocking.
 */
export interface OnboardingStorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface OnboardingStorage {
  /** True on every subsequent app launch once the wizard is complete. */
  getOnboardingCompleted(): Promise<boolean>;
  /** Sets the completed flag. Idempotent. */
  markOnboardingCompleted(): Promise<void>;
}

/**
 * Read the stored completion flag. Returns `false` when the key is
 * absent (fresh install), corrupted (e.g. an unexpected JSON blob),
 * or the backend itself rejects. The "false on error" policy keeps
 * the root gate conservative: a transient AsyncStorage failure is
 * never promoted into "user already saw the welcome flow" — the
 * cost of a re-show is small, the cost of a missed gate (signed-in
 * user landing on `/welcome-finish`) is large.
 */
export async function getOnboardingCompleted(
  backend: OnboardingStorageBackend = AsyncStorage,
): Promise<boolean> {
  try {
    const raw = await backend.getItem(ONBOARDING_COMPLETED_KEY);
    // Strict string equality on the canonical "true" — any other
    // value (undefined, garbage, "False", "1", "yes", JSON) is
    // treated as "not completed". The setter writes the canonical
    // form; the reader is a defensive mirror of that contract.
    return raw === 'true';
  } catch {
    return false;
  }
}

/**
 * Persist the completed flag. Idempotent — repeated calls keep the
 * value as `"true"`. A write failure is swallowed: the user-facing
 * wizard still completes, navigation to auth still happens, and the
 * worst-case behavior on next launch is the gate showing the
 * welcome flow again (acceptable degradation).
 */
export async function markOnboardingCompleted(
  backend: OnboardingStorageBackend = AsyncStorage,
): Promise<void> {
  try {
    await backend.setItem(ONBOARDING_COMPLETED_KEY, 'true');
  } catch {
    // Storage failures are non-fatal — see module doc.
  }
}

/**
 * Test-only seam. Production code uses the default-async-storage
 * signatures above; the harness injects an in-memory backend here
 * without module mocking the native module.
 */
export const __testing__ = {
  createOnboardingStorage(
    backend: OnboardingStorageBackend,
  ): OnboardingStorage {
    return {
      getOnboardingCompleted: () => getOnboardingCompleted(backend),
      markOnboardingCompleted: () => markOnboardingCompleted(backend),
    };
  },
};
