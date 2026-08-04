/**
 * Test double for `expo-linking` (reliability re-gate harness). The OAuth
 * helper builds its redirect URI with `Linking.createURL('oauth')`; the real
 * module resolves the app scheme from expo-constants, so the double returns
 * the deterministic dev-build form the dashboard whitelist expects.
 */
export function createURL(path: string): string {
  return `ticketify://${path}`;
}
