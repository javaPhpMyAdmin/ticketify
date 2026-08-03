/**
 * OAuth PKCE helper (ADR-3).
 *
 * Supabase's OAuth endpoint is driven with `skipBrowserRedirect: true`, which
 * returns the provider's authorization URL instead of navigating. Because the
 * client is configured with `flowType: 'pkce'`, that URL already carries a
 * `code_challenge` and the matching verifier is persisted through the storage
 * adapter. We open the URL with expo-auth-session, collect the `code` the
 * provider redirects back with, and finish the flow with
 * `exchangeCodeForSession(code)` (there is no `setSessionFromUrl` in the
 * installed auth-js — see ADR-3).
 *
 * Redirect URL: `AuthSession.makeRedirectUri({ path: 'oauth' })` resolves to
 * `ticketify://oauth` in development/standalone builds and to
 * `exp://<host>/--/oauth` in Expo Go. BOTH forms must be whitelisted in the
 * Supabase dashboard (Authentication → URL Configuration → Redirect URLs);
 * that dashboard configuration is out of this repo's scope.
 *
 * A cancelled or failed flow returns `{ cancelled: true }` and never creates a
 * session (user-auth spec: "A cancelled or failed flow MUST NOT create a
 * session"). The caller navigates to the app only on success.
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

// Required for web; harmless on native. Completes an in-progress
// auth session when the app regains focus from the browser.
WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'google' | 'apple';

/**
 * The URI the provider redirects to after consent. Keep this in sync with the
 * dashboard whitelist (`ticketify://oauth` for dev builds, the Expo Go
 * `exp://…/--/oauth` form otherwise).
 */
export const oauthRedirectUri: string = AuthSession.makeRedirectUri({
  path: 'oauth',
});

export interface OAuthResult {
  /** True when the user cancelled/dismissed the provider consent. */
  cancelled: boolean;
  /** User-displayable error message, or null on success. */
  error: string | null;
}

/**
 * Runs the full PKCE flow for a provider and returns the outcome. On success
 * the Supabase client holds the new session (SIGNED_IN / onAuthStateChange)
 * and `ensureProfile` runs; the caller should then navigate to the app.
 */
export async function signInWithProvider(
  provider: OAuthProvider,
): Promise<OAuthResult> {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: oauthRedirectUri,
        skipBrowserRedirect: true,
      },
    });
    if (error) return { cancelled: false, error: error.message };
    if (!data.url) return { cancelled: false, error: 'Sign-in could not be started.' };

    // `url` is the fully-formed Supabase authorize URL (already carries the
    // PKCE challenge). The AuthRequest is only used as a browser launcher:
    // promptAsync opens `url` and parses the redirect back into params.
    const authRequest = await AuthSession.loadAsync(
      {
        redirectUri: oauthRedirectUri,
        // Unused by Supabase's flow — AuthRequestConfig requires it. The
        // authorization request is fully built by supabase-js.
        clientId: 'supabase',
        // PKCE is handled by supabase-js; do not add a second challenge.
        usePKCE: false,
      },
      { authorizationEndpoint: data.url },
    );
    const result = await authRequest.promptAsync(
      { authorizationEndpoint: data.url },
      { url: data.url },
    );

    if (result.type !== 'success') {
      // cancel | dismiss | error | locked → no session, stay on sign-in.
      return { cancelled: true, error: null };
    }

    const code = result.params.code;
    if (!code) {
      return { cancelled: false, error: 'The sign-in response was missing its code.' };
    }

    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return { cancelled: false, error: exchangeError.message };

    return { cancelled: false, error: null };
  } catch (err) {
    // Storage unavailable (web), network failure, or an unexpected error:
    // surface a readable message and keep the user on the sign-in screen.
    return {
      cancelled: false,
      error: err instanceof Error ? err.message : 'Sign-in failed. Please try again.',
    };
  }
}
