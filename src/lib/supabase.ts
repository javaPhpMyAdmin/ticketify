// react-native-url-polyfill is required by supabase-js on React Native
// (RN's global `URL` is incomplete); the package is already a dependency.
import 'react-native-url-polyfill/auto';

import Constants from 'expo-constants';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { secureStoreAdapter } from '@/lib/supabase/storage-adapter';

type ExtraConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

/**
 * Real values come from `.env` (`EXPO_PUBLIC_*`, inlined by Expo at build
 * time). The `expoConfig.extra` values in `app.json` are the fallback and
 * still hold placeholders, so the guard below rejects them.
 */
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || '';

const PLACEHOLDER_MARKERS = ['placeholder', 'YOUR-PROJECT', 'YOUR-ANON-KEY'];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

/**
 * The client is created even when configuration is missing so importing this
 * module never throws. Unconfigured requests fail with a detectable network
 * error instead of crashing — callers gate on `isSupabaseConfigured()`.
 *
 * Sessions persist through the chunked SecureStore adapter (values can exceed
 * SecureStore's 2048-byte limit), tokens auto-refresh, and sessions are never
 * detected from the URL (we complete OAuth PKCE manually — ADR-3).
 *
 * `flowType: 'pkce'` is required by ADR-3: `signInWithOAuth` and
 * `resetPasswordForEmail` attach a PKCE code challenge to their URLs and
 * persist the verifier through the storage adapter, and the returned `code`
 * is exchanged with `exchangeCodeForSession(code)`. The default flow
 * (`implicit`) redirects with tokens in the URL fragment instead, which the
 * custom-scheme redirect on native cannot use.
 *
 * `experimental.appendPkceFlowIdToRedirects` makes GoTrue append the flow's
 * `sb_flow_id` to redirect URLs (verified against the installed
 * `@supabase/auth-js@2.111.0` source). It is REQUIRED for the password-
 * recovery flow: `resetPasswordForEmail` does NOT return its flow id, so the
 * recovery email link can only carry it through this flag — without it the
 * exchange falls back to the shared legacy verifier key, which any newer PKCE
 * flow overwrites (intermittent "invalid link" on recovery emails). The OAuth
 * flow does not depend on the flag: `signInWithOAuth` returns its flow id
 * directly (see `src/lib/auth/oauth.ts`).
 *
 * SIDE EFFECT (dashboard config, out of this repo's scope): with the flag on,
 * EVERY redirect — including the OAuth one — gains `?sb_flow_id=…`. GoTrue
 * matches redirect URLs against the dashboard allow list INCLUDING the query
 * string, so exact (non-wildcard) entries stop matching and the redirect
 * falls back to the Site URL. The dashboard entries for `ticketify://oauth`
 * and the recovery redirect must tolerate the parameter (wildcard form, e.g.
 * `ticketify://oauth/*`). signUp/signInWithOtp are unaffected because we
 * never pass an `emailRedirectTo`.
 *
 * Once we run `supabase gen types typescript` (gated on `supabase link`) we'll
 * parameterize this with the generated `Database` type for end-to-end type
 * safety; until then the client stays untyped and `src/types` carries the
 * domain shapes.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      storage: secureStoreAdapter,
      experimental: {
        appendPkceFlowIdToRedirects: true,
      },
    },
  },
);

/**
 * True only when a real URL and anon key are present. Empty values and
 * placeholder markers (from `app.json` or the fallback constants above) both
 * disqualify the configuration.
 */
export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !isPlaceholder(supabaseUrl) &&
    !isPlaceholder(supabaseAnonKey),
);
