/**
 * Test double for `@/features/pro` in the budget-month-local harness.
 *
 * The settings screen calls `useFrozenGuard()` and wraps its save in
 * `guard(...)`. The real hook pulls expo-router + the dialog store; this
 * stub always passes the action through unfrozen (compile-only consumer).
 */
export function useFrozenGuard(): {
  isFrozen: boolean;
  guard: <T>(action: () => T | Promise<T>) => T | Promise<T>;
} {
  return {
    isFrozen: false,
    guard: <T,>(action: () => T | Promise<T>) => action(),
  };
}