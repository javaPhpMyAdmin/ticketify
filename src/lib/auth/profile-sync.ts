/**
 * Profile sync (ADR-6): keep `public.profiles` in sync with `auth.users`.
 *
 * On every sign-in the app ensures the user's own profile row exists by
 * inserting `{ id }` with `ON CONFLICT (id) DO NOTHING`. The RLS policy
 * `profiles_insert_own` (0001_initial_schema.sql) already restricts inserts
 * to `id = auth.uid()`, so a caller can only ever create their own row.
 *
 * The call is deliberately defensive: the `profiles` table is applied to the
 * remote project in Phase 5 (`supabase db push`), so until then the insert may
 * fail with a missing-table error. Profile sync must never break an
 * otherwise-valid auth session, so all failures are swallowed here.
 */
import { supabase } from '@/lib/supabase';

export async function ensureProfile(userId: string): Promise<void> {
  try {
    // Upsert with `ignoreDuplicates: true` maps to `ON CONFLICT (id)
    // DO NOTHING` (ADR-6): the row is created on first sign-in and left
    // untouched on returning sign-ins.
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
    // An error here (missing table pre-migration, RLS denial, network) is
    // non-fatal: the session itself is valid and reads will surface a
    // missing-profile state until the table exists.
    if (error) {
      // Non-fatal: the session itself is valid and reads will surface a
      // missing-profile state until the table exists.
      console.warn('[auth] ensureProfile skipped:', error.message);
    }
  } catch {
    // Storage/network-level failures (e.g. web without a native backend)
    // must not propagate into the session flow either.
  }
}
