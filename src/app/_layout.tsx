import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { useSessionStore } from '@/features/auth';
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
    <>
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
    </>
  );
}
