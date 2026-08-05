import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Spinner, View } from '@/components';
import { useSessionStore } from '@/features/auth';
import {
  decideOAuthCallbackWait,
  exchangeOAuthCode,
  getLastOAuthError,
  isOAuthFlowInFlight,
  type OAuthExchangeResult,
} from '@/lib/auth/oauth';
import { colors } from '@/theme';

/**
 * How long the route waits for the in-process OAuth flow to produce a
 * session before giving up (warm-race bound). The in-process exchange
 * completes milliseconds to a couple of seconds after the callback deep link
 * arrives, so this bound only fires when the flow genuinely stalled.
 */
const OAUTH_CALLBACK_WAIT_MS = 10_000;

/**
 * Bound for the cold-start code exchange (see the cold-start branch below).
 * The in-process flow needs no such bound — the user is actively driving the
 * browser — but a relaunch from a dead process must not hang on this spinner
 * forever if the exchange stalls. On timeout we fall back to sign-in with the
 * generic interrupted copy, exactly like any other failed exchange, and the
 * user can simply retry.
 */
const OAUTH_EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * Mirrors `PROVIDER_FLOW_ERROR` in `src/lib/auth/oauth.ts` (not exported).
 * Kept here so the timeout path surfaces the same generic copy as every other
 * interrupted exchange — no auth-internal detail leaks to the UI.
 */
const OAUTH_EXCHANGE_TIMEOUT_ERROR = 'El inicio de sesión se interrumpió. Inténtalo de nuevo.';

/**
 * Landing route for the OAuth PKCE callback URL (`ticketify://oauth`).
 *
 * The in-process flow (`signInWithProvider`) normally consumes the `code`
 * through `WebBrowser.openAuthSessionAsync`, so this screen is never rendered
 * in that happy path — but it must still resolve to a registered route, or
 * expo-router's implicit catch-all shows the "Unmatched Route" screen on every
 * OAuth return. It IS reached in two cases:
 *
 * 1. COLD START — the app was terminated during provider consent and the OS
 *    delivers the callback as a launch deep link carrying `code` (and
 *    `sb_flow_id` when the PKCE flow id is appended). No in-process flow
 *    survived (`isOAuthFlowInFlight()` is false), so this route consumes the
 *    params itself via the shared `exchangeOAuthCode` helper and routes to `/`
 *    on success, or to `/sign-in` with a user-readable error on failure.
 * 2. WARM RACE — a Linking event delivers the callback while the in-process
 *    flow is still running (`isOAuthFlowInFlight()` is true). Exchanging the
 *    same code here would break PKCE (codes are single-use) and flashing
 *    `/sign-in` would show the wrong screen for a moment, so the route waits
 *    (bounded) for the in-process exchange to set the session instead.
 *
 * PKCE binds the code to the stored verifier, so a dropped callback has no
 * security impact — this is a correctness/UX fix (user-auth spec: cold-start
 * and warm-race callback scenarios).
 */
export default function OAuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    sb_flow_id?: string | string[];
  }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const flowId = Array.isArray(params.sb_flow_id)
    ? params.sb_flow_id[0]
    : params.sb_flow_id;

  useEffect(() => {
    // Duplicate callback delivery after the in-process flow already
    // completed: the store session is authoritative. Do NOT navigate here —
    // on Android the callback deep link can mount this screen before the root
    // gate has committed `(tabs)` (React defers the re-render while the app is
    // backgrounded), so a replace to `/` races the guard and fires the
    // "screen couldn't be applied to the navigator" error. The root layout's
    // session effect owns "go to app" for this exact state: it covers both a
    // null→session flip on `/oauth` and a session already present on `/oauth`
    // with no flip (warm race after the flip was consumed, or a stored-session
    // cold start where `prevSession` never observed null), so yielding here
    // can never strand the spinner.
    if (useSessionStore.getState().session) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let exchangeTimer: ReturnType<typeof setTimeout> | undefined;

    // Failure navigations must re-check the live session at decision time:
    // the cold-start exchange can lose a race against the stored-session
    // restore, and once a session is live the root layout's session effect
    // has already moved the user to `(tabs)` (or will, via its parked
    // clause). Replacing to `/sign-in` from here would strand a signed-in
    // user on the auth screens — the root effect's `prevSession` is already
    // truthy, so it can never rescue them. Genuinely signed-out failures
    // (no session at this moment) still navigate to sign-in with the error.
    const replaceToSignIn = (error: string | null): void => {
      if (useSessionStore.getState().session) {
        return;
      }
      if (error) {
        router.replace({ pathname: '/sign-in', params: { error } });
      } else {
        router.replace('/sign-in');
      }
    };

    const waitForFlow = (onSettled: (error: string | null) => void): void => {
      const deadline = Date.now() + OAUTH_CALLBACK_WAIT_MS;
      const poll = (): void => {
        if (cancelled) return;
        // Pure decision (tested in the auth harness): watch BOTH the session
        // and the in-process flow, so a flow that settles without a session
        // (failed/cancelled) is resolved immediately instead of waiting out
        // the full bound, and its error copy is surfaced on sign-in.
        const decision = decideOAuthCallbackWait(
          useSessionStore.getState().session !== null,
          isOAuthFlowInFlight(),
          Date.now() >= deadline,
          getLastOAuthError(),
        );
        if (decision.action === 'go-app') {
          // The session appeared while polling; the root layout's session
          // effect (flip clause) replaces `/oauth` with `/` once the gate has
          // committed. Navigating from here could target `(tabs)` before it
          // is registered (Android defers the re-render while backgrounded).
          return;
        }
        if (decision.action === 'go-signin') {
          onSettled(decision.error);
          return;
        }
        timer = setTimeout(poll, 100);
      };
      poll();
    };

    if (isOAuthFlowInFlight()) {
      // Warm race: the in-process flow owns this code. Wait for its exchange
      // to settle — never exchange here (single-use code) and never flash
      // sign-in while the session is about to appear.
      waitForFlow((flowError) => {
        if (flowError) {
          replaceToSignIn(flowError);
        } else {
          // Cancelled (or stalled past the bound): plain sign-in, no banner.
          replaceToSignIn(null);
        }
      });
    } else if (code) {
      // Cold start: no in-process flow survived — consume the deep-link code.
      // The exchange is bounded (Promise.race): a relaunch from a dead
      // process must not hang on the spinner if the exchange stalls, so a
      // timeout resolves with the generic interrupted copy and the branch
      // below falls back to sign-in, where the user can retry.
      const timeoutBound = new Promise<OAuthExchangeResult>((resolve) => {
        exchangeTimer = setTimeout(
          () => resolve({ ok: false, error: OAUTH_EXCHANGE_TIMEOUT_ERROR }),
          OAUTH_EXCHANGE_TIMEOUT_MS,
        );
      });
      void Promise.race([exchangeOAuthCode(code, flowId ?? null), timeoutBound]).then(
        (result) => {
          if (cancelled) return;
          if (result.ok) {
            // The exchange set the session (SIGNED_IN → store), so the root
            // layout's session effect fires the null→session flip and
            // replaces this screen with `/`. A second replace here would race
            // it (and could target `(tabs)` before the gate commits).
            return;
          } else {
            replaceToSignIn(result.error);
          }
        },
      );
    } else {
      // No code and no in-process flow: nothing will produce a session
      // (provider denial, malformed callback). Return to the sign-in screen.
      replaceToSignIn(null);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (exchangeTimer) clearTimeout(exchangeTimer);
    };
  }, [code, flowId]);

  // Every path above navigates away; until then, hold a quiet spinner so the
  // exchange/wait is visible instead of a blank frame.
  return (
    <View style={styles.container}>
      <Spinner size="lg" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
