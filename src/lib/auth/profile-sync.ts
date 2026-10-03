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

/**
 * Writes the region-derived default currency at profile-row CREATION only.
 *
 * @param userId  The signed-in user's profile id (`auth.uid()`).
 * @param currency Region-derived ISO 4217 code; upper-cased here so this
 *   write boundary is canonical regardless of the caller's casing (NFR-1).
 *
 * Never rejects: an existing row (23505), a missing table, or an RLS denial
 * all resolve quietly with a `console.warn`, exactly like `ensureProfile`.
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
      // Non-fatal by contract. The overwhelmingly common cause is 23505 (the
      // row already exists), which is the desired outcome: the user's own
      // choice stands.
      console.warn('[auth] ensureProfileCurrency skipped:', error.message);
    }
  } catch (err) {
    console.warn(
      '[auth] ensureProfileCurrency failed:',
      err instanceof Error ? err.message : err,
    );
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
