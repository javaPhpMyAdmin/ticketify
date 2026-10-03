/**
 * Profile sync (ADR-6): keep `public.profiles` in sync with `auth.users`.
 *
 * On every sign-in the app upserts the user's profile row keyed on `id` and
 * BACKFILLS the identity metadata the provider returned (full_name, avatar_url
 * from `user_metadata`). Unlike the original `ON CONFLICT DO NOTHING` insert,
 * the upsert also updates existing rows, so a profile created before identity
 * sync (e.g. via email/password) is populated on the next sign-in — including
 * sign-ins from a different provider, which replace the stored identity.
 *
 * Only defined identity values are ever written: `user_metadata` values that
 * are undefined OR literal `null` (e.g. Apple / client-controlled metadata)
 * are normalized to undefined, which supabase-js drops out of the payload
 * during serialization. A provider that returns no identity therefore never
 * clobbers previously stored values, and the domain columns (tier, budget,
 * currency) are never included in the payload at all. The RLS policies
 * `profiles_insert_own` / `profiles_update_own` (0001_initial_schema.sql)
 * already restrict writes to `id = auth.uid()`, so a caller can only ever
 * touch their own row.
 *
 * The call is deliberately defensive: the `profiles` table is applied to the
 * remote project in Phase 5 (`supabase db push`), so until then the upsert may
 * fail with a missing-table error. Profile sync must never break an
 * otherwise-valid auth session, so all failures are swallowed here — but they
 * are still logged so a silent backfill outage stays observable.
 *
 * `ensureProfileCurrency` is the ONLY writer of `profiles.currency` at sign-in
 * time and it is CREATE-ONLY: a plain INSERT, never an upsert. On first launch
 * the row does not exist yet, so the insert creates it carrying the
 * region-derived code; on every later sign-in Postgres rejects the duplicate
 * with 23505 and the error is swallowed, leaving the row — and therefore a
 * currency the user deliberately chose — untouched. Clobbering is not
 * "avoided" by a guard here, it is structurally unrepresentable. A conditional
 * update (`is('currency', <default>)`) was rejected precisely because it would
 * rewrite a user who deliberately picked `USD` on an `MX` device, which is
 * indistinguishable from a seeded row.
 *
 * ORDERING: this must run BEFORE `ensureProfile`, because the upsert creates
 * the row first and the seed could then never fire. Supabase-only imports live
 * here (no `getLocales()`): the native adapter is `src/i18n/device-currency.ts`
 * and the caller passes the already-derived code in.
 */
import type { User as AuthUser } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/** Postgres unique-violation. The `ON CONFLICT`-free seed INSERT hits this on
 *  every sign-in after the first, so it is the EXPECTED outcome and not an
 *  incident. */
const PG_DUPLICATE_KEY = '23505';

/** Message fragments that identify the same unique violation when the client
 *  hands back no `code` (a PostgREST error through some transports carries only
 *  `message`). Mirrors `use-session-store`'s duplicate-account classifier. */
const DUPLICATE_KEY_MARKERS = ['23505', 'duplicate key', 'unique constraint'];

/**
 * Whether an error is the seed INSERT losing to an already-existing row.
 *
 * Accepts both shapes the failure arrives in: the resolved `{ error }` object
 * from supabase-js (a PostgREST error with `code`) and a thrown transport
 * error (often just an `Error` with a message). Getting this classification
 * wrong in EITHER direction is a real defect: treating the expected duplicate
 * as a failure trains the team to ignore this log line, and treating a genuine
 * RLS/network failure as "expected" hides a seeding bug entirely.
 */
function isDuplicateKeyError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === PG_DUPLICATE_KEY) return true;
  const haystack = `${typeof code === 'string' ? code : ''} ${
    typeof message === 'string' ? message : ''
  }`.toLowerCase();
  return DUPLICATE_KEY_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * The error's message, or a marker when the failure carries none.
 *
 * Deliberately does NOT gate on `instanceof Error`: supabase-js resolves a
 * PostgREST failure as a PLAIN object (`PostgrestError` — `message`, `code`,
 * `details`), never an `Error` subclass, so an `instanceof`-only read would
 * replace every real database cause on the main path with a generic string and
 * leave the log saying nothing. Read the field, and say so when it is absent.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string' && err) return err;
  if (err !== null && typeof err === 'object') {
    const { message } = err as { message?: unknown };
    if (typeof message === 'string' && message) return message;
  }
  return 'a failure with no readable message';
}

/** The error's Postgres/HTTP code, when it has one — the field that says
 *  whether this is a missing table, an RLS denial or a 5xx. */
function errorCode(err: unknown): string {
  if (err === null || typeof err !== 'object') return 'NONE';
  const { code } = err as { code?: unknown };
  return typeof code === 'string' && code ? code : 'NONE';
}

/**
 * Writes the region-derived default currency at profile-row CREATION only.
 *
 * @param userId  The signed-in user's profile id (`auth.uid()`).
 * @param currency Region-derived ISO 4217 code; upper-cased here so this
 *   write boundary is canonical regardless of the caller's casing (NFR-1).
 *
 * Never rejects, so auth is never blocked by this call. The two failure
 * classes are logged at DIFFERENT severities on purpose: the duplicate is the
 * desired steady state (the user's own choice stands) and is debug noise,
 * while an RLS denial / missing table / 5xx means the seed silently never
 * landed and is worth a warn carrying the code.
 *
 * Logs carry no user identifiers: the id is never interpolated, and neither is
 * anything else that identifies the account.
 */
export async function ensureProfileCurrency(
  userId: string,
  currency: string,
): Promise<void> {
  try {
    // INSERT (never upsert). An existing row → 23505 → swallowed → zero writes.
    const { error } = await supabase
      .from('profiles')
      .insert({ id: userId, currency: currency.toUpperCase() });
    if (error) {
      if (isDuplicateKeyError(error)) {
        // Expected from the second sign-in onward: the row exists, so the seed
        // wrote nothing and a currency the user chose is untouched.
        console.debug(
          '[auth] ensureProfileCurrency: the profile row already exists, seed not applied (expected after first sign-in)',
        );
      } else {
        console.warn(
          `[auth] ensureProfileCurrency failed (code=${errorCode(error)}):`,
          errorMessage(error),
        );
      }
    }
  } catch (err) {
    // A throw is never the duplicate case in practice — supabase-js resolves
    // unique violations into `{ error }` — but a transport that throws a
    // 23505-shaped error must not be reported as an outage, so the same
    // classifier runs on the caught value.
    if (isDuplicateKeyError(err)) {
      console.debug(
        '[auth] ensureProfileCurrency: the profile row already exists, seed not applied (expected after first sign-in)',
      );
    } else {
      console.warn(
        `[auth] ensureProfileCurrency threw (code=${errorCode(err)}):`,
        errorMessage(err),
      );
    }
  }
}

export async function ensureProfile(user: AuthUser): Promise<void> {
  try {
    const { id, user_metadata } = user;
    // Upsert with `onConflict: 'id'` (no `ignoreDuplicates`): the row is
    // created on first sign-in and its identity metadata backfilled on every
    // later sign-in. `?? undefined` folds literal `null` metadata into
    // undefined; supabase-js drops undefined keys from the payload, so only
    // defined strings are written and the existing row's domain columns stay
    // untouched.
    const { error } = await supabase.from('profiles').upsert(
      {
        id,
        full_name: user_metadata?.full_name ?? undefined,
        avatar_url: user_metadata?.avatar_url ?? undefined,
      },
      { onConflict: 'id' },
    );
    // An error here (missing table pre-migration, RLS denial, network) is
    // non-fatal: the session itself is valid and reads will surface a
    // missing-profile state until the table exists.
    if (error) {
      // Non-fatal: the session itself is valid and reads will surface a
      // missing-profile state until the table exists.
      console.warn('[auth] ensureProfile skipped:', error.message);
    }
  } catch (err) {
    // Storage/network-level failures (e.g. web without a native backend)
    // must not propagate into the session flow either, but they should not
    // stay invisible either — a serialization/programming error here would
    // otherwise fail silently on every sign-in.
    console.warn(
      '[auth] ensureProfile failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
