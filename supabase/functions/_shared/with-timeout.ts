// supabase/functions/_shared/with-timeout.ts
//
// AbortController-based timeout helper for outbound fetch calls from
// edge functions. The edge gateway imposes a hard 60-second wall
// (configurable per project), so an explicit bound is mandatory for
// any HTTP call to a third party — a stalled RevenueCat / Stripe /
// Gemini call would otherwise hold a function instance and exhaust
// the concurrency budget.
//
// Usage:
//   const res = await withTimeout(
//     fetch(url, { method: 'DELETE', headers: { Authorization: \`Bearer ${key}\` } }),
//     { ms: 5000, label: 'revenuecat.revokeSubscriber' },
//   );
//
// On timeout the helper throws `TimeoutError`. Callers can catch
// it (or any other rejection) and map to the project's stable
// error-code envelope (e.g. 'revenuecat_revoke_failed').
//
// Env: none.

export class TimeoutError extends Error {
  readonly label: string;
  readonly ms: number;
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
    this.label = label;
    this.ms = ms;
  }
}

export interface TimeoutOptions {
  /** Wall-clock budget in milliseconds. */
  ms: number;
  /** Free-form label included in the `TimeoutError` message and logs. */
  label: string;
}

/**
 * Race a promise against an AbortController-armed timeout. If the
 * promise rejects with an AbortError (the only error fetch raises
 * when its signal aborts), rethrow as `TimeoutError` so the caller
 * does not have to special-case the DOMException type.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  opts: TimeoutOptions,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.ms);

  // Compose the caller's signal (if any) with our timeout signal so
  // either side aborting cancels the fetch. The `signal` parameter
  // is OPTIONAL — most callers do not pass one, in which case the
  // timeout is the sole abort source.
  try {
    return await new Promise<T>((resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new TimeoutError(opts.label, opts.ms));
      });
      promise.then(resolve, reject);
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'AbortError' ||
        (typeof DOMException !== 'undefined' &&
          err instanceof DOMException &&
          err.name === 'AbortError'))
    ) {
      throw new TimeoutError(opts.label, opts.ms);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
