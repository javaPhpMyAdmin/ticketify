import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Spinner, View } from '@/components';
import { useSessionStore } from '@/features/auth';
import { exchangeOAuthCode, isOAuthFlowInFlight } from '@/lib/auth/oauth';
import { colors } from '@/theme';

/**
 * How long the route waits for the in-process OAuth flow to produce a
 * session before giving up (warm-race bound). The in-process exchange
 * completes milliseconds to a couple of seconds after the callback deep link
 * arrives, so this bound only fires when the flow genuinely stalled.
 */
const OAUTH_CALLBACK_WAIT_MS = 10_000;

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
    // completed: the store session is authoritative.
    if (useSessionStore.getState().session) {
      router.replace('/');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const waitForSession = (onTimeout: () => void): void => {
      const deadline = Date.now() + OAUTH_CALLBACK_WAIT_MS;
      const poll = (): void => {
        if (cancelled) return;
        if (useSessionStore.getState().session) {
          router.replace('/');
          return;
        }
        if (Date.now() >= deadline) {
          onTimeout();
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
      waitForSession(() => {
        // The in-process flow produced no session in time. Fall back to
        // sign-in rather than risking a duplicate exchange.
        router.replace('/sign-in');
      });
    } else if (code) {
      // Cold start: no in-process flow survived — consume the deep-link code.
      void exchangeOAuthCode(code, flowId ?? null).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          router.replace('/');
        } else {
          router.replace({
            pathname: '/sign-in',
            params: { error: result.error ?? undefined },
          });
        }
      });
    } else {
      // No code and no in-process flow: nothing will produce a session
      // (provider denial, malformed callback). Return to the sign-in screen.
      router.replace('/sign-in');
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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
