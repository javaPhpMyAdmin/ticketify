/**
 * Pure derivation of the Supabase configuration status.
 *
 * Real values come from `.env` (`EXPO_PUBLIC_*`, inlined by Expo at build
 * time). The `expoConfig.extra` values in `app.json` are the fallback and
 * still hold placeholders (`https://YOUR-PROJECT.supabase.co`,
 * `YOUR-ANON-KEY`), so the derivation rejects them.
 *
 * Kept free of any native/bundler dependency (no expo-constants, no
 * SecureStore) so the app module and the node test harnesses exercise the
 * exact same contract — if the placeholder guard were deleted, the harness
 * tests fail.
 */
const PLACEHOLDER_MARKERS = ['placeholder', 'YOUR-PROJECT', 'YOUR-ANON-KEY'];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

/**
 * True only when a real URL and anon key are present. Empty/missing values
 * and placeholder markers (from `app.json` or the fallback constants) both
 * disqualify the configuration.
 */
export function isSupabaseConfigured(
  url: string | undefined,
  anonKey: string | undefined,
): boolean {
  return Boolean(
    url && anonKey && !isPlaceholder(url) && !isPlaceholder(anonKey),
  );
}
