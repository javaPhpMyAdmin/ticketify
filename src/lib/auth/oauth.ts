/**
 * OAuth PKCE helper (ADR-3, reliability re-gate).
 *
 * Supabase's OAuth endpoint is driven with `skipBrowserRedirect: true`, which
 * returns the provider's authorization URL instead of navigating. Because the
 * client is configured with `flowType: 'pkce'`, that URL already carries a
 * `code_challenge` and the matching verifier is persisted through the storage
 * adapter. We open the URL with `WebBrowser.openAuthSessionAsync`, collect the
 * `code` the provider redirects back with, and finish the flow with
 * `exchangeCodeForSession(code)` (there is no `setSessionFromUrl` in the
 * installed auth-js — see ADR-3).
 *
 * The redirect is deliberately NOT driven through expo-auth-session's
 * AuthRequest: its `parseReturnUrl` validates the random `state` it generates
 * itself, and Supabase's authorize URL carries no `state`, so every attempt
 * would fail with `state_mismatch`. `openAuthSessionAsync` only hands the
 * callback URL back and lets us parse the `code` ourselves.
 *
 * Redirect URL: `Linking.createURL('oauth')` resolves to `ticketify://oauth`
 * in development/standalone builds and to `exp://<host>/--/oauth` in Expo Go
 * (identical to `AuthSession.makeRedirectUri({ path: 'oauth' })`, which wraps
 * the same call). BOTH forms must be whitelisted in the Supabase dashboard
 * (Authentication → URL Configuration → Redirect URLs); that dashboard
 * configuration is out of this repo's scope.
 *
 * A cancelled flow returns `{ cancelled: true }`; any other outcome that does
 * not produce a session is surfaced as a REAL error (user-auth spec: "A
 * cancelled or failed flow MUST NOT create a session"). The caller navigates
 * to the app only on success.
 */
import * as Linking from 'expo-linking';
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
export const oauthRedirectUri: string = Linking.createURL('oauth');

export interface OAuthResult {
  /** True when the user cancelled/dismissed the provider consent. */
  cancelled: boolean;
  /** User-displayable error message, or null on success. */
  error: string | null;
}

/** Outcome of a standalone PKCE code exchange (see `exchangeOAuthCode`). */
export interface OAuthExchangeResult {
  ok: boolean;
  /** User-displayable error message when `ok` is false (generic copy). */
  error: string | null;
}

/** The PKCE auth code GoTrue puts in the callback URL's query string. */
function codeFromCallbackUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('code');
  } catch {
    return null;
  }
}

/**
 * The PKCE flow id GoTrue appends to the callback URL (`sb_flow_id`) when the
 * flow is identifiable, so the exchange uses that flow's stored verifier
 * instead of the shared legacy slot (which any newer flow overwrites).
 *
 * PRIMARY SOURCE is the `flowId` that `signInWithOAuth` returns in its result
 * (verified against auth-js 2.111.0: `OAuthResponse.data.flowId` is always set
 * at runtime). The callback URL only carries `sb_flow_id` when
 * `experimental.appendPkceFlowIdToRedirects` is enabled, so parsing it here is
 * only a fallback for SDK versions that return no flow id.
 */
function flowIdFromCallbackUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('sb_flow_id');
  } catch {
    return null;
  }
}

/**
 * Exchanges a PKCE auth code for a session.
 *
 * Shared by the in-process flow (`signInWithProvider`) and the OAuth callback
 * route (`src/app/oauth.tsx`), which consumes deep-link params on cold start
 * when the in-process flow did not survive. `flowId` selects the stored
 * verifier slot for THIS flow; when null the exchange falls back to the shared
 * legacy key. A failed exchange surfaces generic copy — never the raw GoTrue
 * message (no auth-internal leakage in the UI).
 */
export async function exchangeOAuthCode(
  code: string,
  flowId: string | null,
): Promise<OAuthExchangeResult> {
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (error) {
      return {
        ok: false,
        error: 'Sign-in was interrupted. Please try again.',
      };
    }
    return { ok: true, error: null };
  } catch (err) {
    // Network/storage failure: surface a readable message (same posture as
    // signInWithProvider) and let the caller keep the user on sign-in.
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Sign-in was interrupted. Please try again.',
    };
  }
}

/**
 * True while `signInWithProvider` is running — from the provider tap until
 * the flow settles. The OAuth callback route reads this to resolve the warm
 * race: when the deep link arrives while the in-process flow is still
 * exchanging, the route defers to it instead of exchanging the same code
 * twice (PKCE codes are single-use) or flashing the sign-in screen. A
 * terminated process resets the flag, so a cold-start callback always sees
 * `false` and exchanges the code itself.
 */
let providerFlowInFlight = false;

export function isOAuthFlowInFlight(): boolean {
  return providerFlowInFlight;
}

/**
 * Runs the full PKCE flow for a provider and returns the outcome. On success
 * the Supabase client holds the new session (SIGNED_IN / onAuthStateChange)
 * and `ensureProfile` runs; the caller should then navigate to the app.
 */
export async function signInWithProvider(
  provider: OAuthProvider,
): Promise<OAuthResult> {
  providerFlowInFlight = true;
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
    // PKCE challenge). Open it in the system browser; on redirect the promise
    // resolves with the callback URL carrying `code`.
    const result = await WebBrowser.openAuthSessionAsync(data.url, oauthRedirectUri);

    if (result.type === 'cancel') {
      // User dismissed the consent screen: no session, stay on sign-in.
      return { cancelled: true, error: null };
    }
    if (result.type !== 'success') {
      // dismiss | opened | locked — the browser flow did not complete. Surface
      // a real error instead of silently swallowing it as a cancellation.
      return { cancelled: false, error: 'Sign-in was interrupted. Please try again.' };
    }

    const code = codeFromCallbackUrl(result.url);
    if (!code) {
      return { cancelled: false, error: 'The sign-in response was missing its code.' };
    }

    // The flow id returned by signInWithOAuth selects THIS flow's stored
    // verifier slot for the exchange — never the shared legacy key, which any
    // newer PKCE flow overwrites. The callback-URL fallback only covers SDKs
    // that return no flow id.
    const flowId = data.flowId ?? flowIdFromCallbackUrl(result.url);
    const exchange = await exchangeOAuthCode(code, flowId);
    if (!exchange.ok) return { cancelled: false, error: exchange.error };

    return { cancelled: false, error: null };
  } catch (err) {
    // Storage unavailable (web), network failure, or an unexpected error:
    // surface a readable message and keep the user on the sign-in screen.
    return {
      cancelled: false,
      error: err instanceof Error ? err.message : 'Sign-in failed. Please try again.',
    };
  } finally {
    providerFlowInFlight = false;
  }
}
