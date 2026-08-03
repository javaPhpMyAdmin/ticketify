import { Redirect } from 'expo-router';

import { useSessionStore } from '@/features/auth';

/**
 * Landing route for the OAuth PKCE callback URL (`ticketify://oauth`).
 *
 * The OAuth helper (`src/lib/auth/oauth.ts`) consumes the `code` in-process
 * through `WebBrowser.openAuthSessionAsync`, so this screen is normally never
 * rendered — but the deep link must still resolve to a registered route, or
 * expo-router's implicit catch-all shows the "Unmatched Route" screen on every
 * OAuth return. It renders nothing and redirects away immediately: signed in
 * (the helper already exchanged the code) → app content; otherwise → sign-in.
 */
export default function OAuthCallbackScreen() {
  const session = useSessionStore((s) => s.session);
  return <Redirect href={session ? '/' : '/sign-in'} />;
}
