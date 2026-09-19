/**
 * Pure legal-consent decision logic (legal-compliance change — U4).
 *
 * Everything here is a pure function over plain data: the rows read from
 * `legal_acceptances`, a simple status tag, and the pending flag persisted on
 * the device at sign-up. Keeping the decisions pure makes them trivially
 * testable (U4 harness section 2) and lets the UI layer (ConsentGate, the
 * sign-up screen) share ONE source of truth.
 *
 * Fail-closed posture (design R-5): consent is NEVER assumed from missing
 * data — an empty read, a failed read, or a stale version all resolve to
 * "gated".
 */
import type { LegalDocument } from '@/lib/legal-urls';

import { LATEST_LEGAL_VERSIONS } from './legal-versions';

/** One `legal_acceptances` row (the columns the client reads). */
export interface LegalAcceptanceRow {
  document: LegalDocument;
  version: string;
}

/**
 * The gate's status tag:
 *  - `loading`: the read is still in flight (show no gate yet — flashing a
 *    gate over a signed-in user who already consented is a bad look);
 *  - `complete`: both documents accepted at the LATEST version;
 *  - `gated`: anything else (missing rows, stale version, failed read).
 */
export type LegalConsentStatus = 'loading' | 'complete' | 'gated';

/**
 * The device-side pending acceptance flag, written atomically at sign-up
 * BEFORE the network sign-up call (so a consent given is never lost if the
 * call fails) and flushed on the next signed-in session (U4/U5).
 */
export interface PendingAcceptanceFlag {
  /** Email of the user who accepted — protects against flushing another account. */
  email: string;
  /** The shared ISO version accepted (AD-4; must equal LATEST_LEGAL_VERSIONS). */
  version: string;
  /** ISO timestamp of the device-side acceptance. */
  acceptedAt: string;
}

/**
 * True when `rows` proves BOTH documents were accepted at their LATEST
 * version. A row at an older version does NOT count: the user consented to
 * text that is no longer current, so the gate must ask again (R-5).
 */
export function isConsentComplete(
  rows: LegalAcceptanceRow[],
  latest: Record<LegalDocument, string> = LATEST_LEGAL_VERSIONS,
): boolean {
  return (['privacy', 'terms'] as const).every((document) =>
    rows.some((row) => row.document === document && row.version === latest[document]),
  );
}

/**
 * Whether the consent gate may cover the app on a route. The gate covers
 * everything EXCEPT `/legal/*`: the legal document screens must stay
 * reachable while gated so the user can re-read the terms they are being
 * asked to accept (design U5 — legal routes registered outside the protected
 * stack).
 */
export function shouldShowConsentGate(
  status: LegalConsentStatus,
  pathname: string,
): boolean {
  return status === 'gated' && !pathname.startsWith('/legal/');
}

/** What to do with a pending flag on a signed-in session. */
export type FlushDecision = 'flush' | 'clear-stale';

/**
 * Decide what a pending flag means for the CURRENT signed-in user:
 *  - `flush`: the flag belongs to this email AND the accepted version is
 *    still current → record the acceptances on the backend, then clear.
 *  - `clear-stale`: the flag was left by ANOTHER account (email mismatch) or
 *    references a superseded version → it must never be flushed for this
 *    user; wipe it silently.
 */
export function flushDecision(
  flag: PendingAcceptanceFlag,
  userEmail: string,
  latest: Record<LegalDocument, string> = LATEST_LEGAL_VERSIONS,
): FlushDecision {
  if (flag.email !== userEmail) return 'clear-stale';
  if (flag.version !== latest.privacy || flag.version !== latest.terms) {
    return 'clear-stale';
  }
  return 'flush';
}