/**
 * Races `promise` against a timer and ALWAYS cancels the timer once either
 * side wins. Cancelling matters beyond hygiene: a promise that settles early
 * must not leave a pending timeout keeping the process alive (the auth test
 * harness previously lingered ~10 s per restore test on leaked timers).
 * `fallback` is the race result when the bound fires first.
 *
 * Extracted from the auth session store so the RevenueCat wrapper can reuse
 * the same bounded-wait pattern for identity calls — a hung native call
 * must never stall the Pro bootstrap or block sign-out.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      handle = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}