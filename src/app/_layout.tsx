import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { useSessionStore } from '@/features/auth';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

/**
 * Root gate (ADR-5): app content is registered inside a Stack.Protected
 * that is only visible when NOT (authenticated mode && no session).
 *
 * - demo mode (web default, fresh native installs) → gate open
 * - authenticated mode with session (restored, signed in, recovered) → gate open
 * - authenticated mode without session (signed out, expired token) → gate
 *   closed; (auth) screens are the only registered routes, so the sign-in
 *   screen becomes the initial route.
 *
 * The splash stays up until the stored session restore resolves, so there
 * is no flash of the wrong mode.
 */
export default function RootLayout() {
  const restore = useSessionStore((s) => s.restore);
  const isBootstrapping = useSessionStore((s) => s.isBootstrapping);
  const session = useSessionStore((s) => s.session);
  const mode = useSettingsStore((s) => s.mode);

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

  const gateOpen = !(mode === 'authenticated' && !session);

  return (
    <>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Protected guard={gateOpen}>
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
