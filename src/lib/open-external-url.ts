/**
 * Injectable external-link opener (REQ-1 / AD-1).
 *
 * Opens `url` in the platform browser and never throws: a rejected open
 * (browser unavailable, platform error, user dismissal) resolves `false` so
 * callers can fire-and-forget without a user-facing error path.
 *
 * The `opener` is injectable — it defaults to the platform
 * `WebBrowser.openBrowserAsync` and contract tests substitute a stub without
 * touching the SDK. No session/auth/store imports: this module MUST stay
 * usable from pre-auth screens (sign-up) and authenticated screens (profile)
 * alike (pre-auth safety NFR).
 */
import * as WebBrowser from 'expo-web-browser';

/**
 * Structural opener contract (AD-1): widened to `unknown` so the platform
 * `WebBrowserResult` AND every stub return shape (booleans, `{type:'opened'}`)
 * are structural subtypes — a dedicated union would force casts at every test
 * seam. Callers only observe resolve/reject, never the payload.
 */
export type ExternalUrlOpener = (url: string) => Promise<unknown>;

export async function openExternalUrl(
  url: string,
  opener: ExternalUrlOpener = WebBrowser.openBrowserAsync,
): Promise<boolean> {
  // Defense in depth (REQ-1): only https URLs may reach the browser opener.
  // REQ-2 already guarantees legal URLs are https, but this is public API —
  // the guard maps onto the reject path (silent `false`) and never throws.
  if (!url.startsWith('https://')) return false;
  try {
    await opener(url);
    return true;
  } catch (err) {
    // Deliberate split: silent to the user (REQ-1), visible to the operator
    // via console.warn (matches repo log style, e.g. useLocaleStore.ts).
    console.warn('[openExternalUrl] failed to open', url, err);
    return false;
  }
}
