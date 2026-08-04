import { Stack } from 'expo-router';

import { colors } from '@/theme';

/**
 * Stack for the (auth) route group: sign-in, sign-up, forgot-password.
 * The group itself is registered in the root layout (task 2.8) so these
 * screens are reachable whenever the root gate blocks the app content.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
