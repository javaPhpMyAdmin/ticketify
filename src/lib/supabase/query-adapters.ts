/**
 * Throwing adapters over the read seam (server-state-caching spec — D3).
 *
 * The seam (`feature-access.ts` + feature `api.ts`) returns discriminated
 * `FeatureReadResult` values. Hooks turn that union into data-or-throw at the
 * queryFn boundary so retry fires and a failure NEVER caches as success. The
 * thrown `FeatureQueryError` carries a retry-gating kind plus the seam's
 * user-safe message; the client-wide `shouldRetry` gate keys off the kind
 * (definitive kinds are never retried).
 */
import {
  READ_ERROR_MESSAGE,
  type FeatureReadResult,
} from '@/lib/supabase/feature-access';

/**
 * User-safe copy when the signed-in user has no `profiles` row yet. Single
 * source (D3): previously duplicated in useProfile.ts and useBudget.ts.
 */
export const MISSING_PROFILE_MESSAGE =
  'Your profile is not set up yet. Please try again.';

/** The retry-gating error kinds the adapters can throw. */
export type FeatureQueryErrorKind = 'missing-profile' | 'unconfigured' | 'error';

/**
 * Typed error thrown by `toQueryData` for every non-ok status. Carries the
 * retry-gating kind and the seam's user-safe message (raw backend text never
 * crosses the seam).
 */
export class FeatureQueryError extends Error {
  readonly kind: FeatureQueryErrorKind;

  constructor(kind: FeatureQueryErrorKind, message: string) {
    super(message);
    this.name = 'FeatureQueryError';
    this.kind = kind;
  }
}

/**
 * Converts a seam result into query data or throws. `ok` resolves the data —
 * an ok-with-null result (scan usage for a fresh month) is SUCCESSFUL null
 * data, never an error. Every other status throws a `FeatureQueryError`.
 */
export function toQueryData<T>(result: FeatureReadResult<T>): T {
  switch (result.status) {
    case 'ok':
      return result.data;
    case 'missing-profile':
      throw new FeatureQueryError('missing-profile', READ_ERROR_MESSAGE);
    case 'unconfigured':
      throw new FeatureQueryError('unconfigured', READ_ERROR_MESSAGE);
    case 'error':
      throw new FeatureQueryError('error', result.message);
  }
}

/**
 * Retry gate used as the client-wide `retry` default (D3). Definitive kinds
 * (`missing-profile`, `unconfigured`) can never succeed on a retry → false.
 * Everything else falls through to `failureCount < 2`, i.e. up to 2 retries
 * before the error surfaces (v5 default retry = 3 overridden). Unknown
 * (non-`FeatureQueryError`) rejections also fall through so the gate still
 * bounds them.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof FeatureQueryError) {
    if (error.kind === 'missing-profile' || error.kind === 'unconfigured') {
      return false;
    }
  }
  return failureCount < 2;
}

/**
 * Maps a thrown error to user-safe copy. `missing-profile` → the dedicated
 * message (single source); other kinds → their carried message;
 * non-`FeatureQueryError` rejections → the generic read copy.
 */
export function toQueryErrorMessage(error: unknown): string {
  if (error instanceof FeatureQueryError) {
    if (error.kind === 'missing-profile') return MISSING_PROFILE_MESSAGE;
    return error.message;
  }
  return READ_ERROR_MESSAGE;
}
