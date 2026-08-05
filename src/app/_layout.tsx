import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';

import { useSessionStore } from '@/features/auth';
import { decideSessionNavigation } from '@/lib/auth/session-nav';
import { queryClient } from '@/lib/query-client';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

/**
 * Root gate (ADR-5): app content is registered inside a Stack.Protected
 * that is only visible when a session exists. Sign-in is mandatory from
 * launch — there is no data-source mode to reconcile:
 *
 * - session (restored, signed in, recovered) → gate open
 * - no session (fresh install, signed out, expired token) → gate closed;
 *   (auth) screens are the only registered routes, so the sign-in screen
 *   becomes the initial route.
 *
 * The splash stays up until the stored session restore resolves, so there
 * is no flash of the wrong screen.
 */
export default function RootLayout() {
  const restore = useSessionStore((s) => s.restore);
  const isBootstrapping = useSessionStore((s) => s.isBootstrapping);
  const session = useSessionStore((s) => s.session);
  const prevSession = useRef(session);
  const pathname = usePathname();

  // Single owner of "go to app" navigation. The decision is a pure function
  // (`decideSessionNavigation` in src/lib/auth/session-nav.ts, unit-tested in
  // the auth harness) with two independent conditions, both suppressed on
  // `/reset-password` (that screen owns its exit: the recovery exchange signs
  // in with a recovery session before the user picks a new password, so this
  // effect must not steal it):
  //
  // 1. The session flipped from null to a session — the gate has committed
  //    `(tabs)` by the time this effect runs, so the replace can never race
  //    the Stack.Protected guard (ADR: auth gate). This covers email
  //    sign-in/sign-up and the OAuth cold-start exchange.
  // 2. A session is present while `/oauth` is on screen, with no null→session
  //    flip observed by this effect (warm race after the flip was consumed,
  //    or a stored-session cold start where `prevSession` was never null).
  //    The callback screen (`src/app/oauth.tsx`) deliberately yields to this
  //    effect instead of navigating itself: the gate is always committed
  //    before the replace targets `(tabs)`, and there is never a second
  //    navigation racing the first.
  //
  // The deep-link intent is derived from `pathname` (reactive), never from a
  // `Linking.getInitialURL()` snapshot: a non-reactive ref write would leave
  // the decision depending on the promise ordering between the session
  // restore/flip and the initial-URL delivery.
  useEffect(() => {
    const decision = decideSessionNavigation({
      prevSession: prevSession.current,
      session,
      pathname,
    });
    if (decision.shouldNavigate) {
      router.replace(decision.target);
    }
    prevSession.current = session;
  }, [session, pathname]);

  const [booted, setBooted] = useState(false);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (!isBootstrapping) setBooted(true);
  }, [isBootstrapping]);

  useEffect(() => {
    // Hide the native splash once restore reconciled and the first frame
    // has rendered; the gate then decides which routes are reachable.
    if (booted) {
      SplashScreen.hideAsync().catch(() => {
        // safe to ignore — already hidden or interrupted by another call
      });
    }
  }, [booted]);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Protected guard={session != null}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="ticket/camera"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="ticket/review/[id]"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack.Protected>
        <Stack.Screen name="(auth)" />
      </Stack>
    </QueryClientProvider>
  );
}
