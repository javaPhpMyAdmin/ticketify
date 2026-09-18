/**
 * Test double for `expo-web-browser` (reliability re-gate harness). The real
 * module is native and cannot load in plain node. `openAuthSessionAsync`
 * returns whichever result the harness configured last, so the OAuth helper's
 * success / cancel / interrupted mapping is fully deterministic.
 */
export type StubWebBrowserResult =
  | { type: 'success'; url: string }
  | { type: 'cancel' | 'dismiss' | 'opened' | 'locked' };

let nextResult: StubWebBrowserResult = { type: 'cancel' };

// Last URL handed to `openBrowserAsync` (legal-links harness). `null` until
// the first call — the contract the opener tests assert before any open.
let lastOpenedUrl: string | null = null;

export function __setNextBrowserResult(result: StubWebBrowserResult): void {
  nextResult = result;
}

/**
 * Stub for `WebBrowser.openBrowserAsync` — records the URL and resolves as
 * "opened", so the legal-links opener contract is deterministic in plain
 * node. Additive: the auth harness (openAuthSessionAsync seam) is untouched.
 */
export async function openBrowserAsync(
  url: string,
): Promise<{ type: 'opened' }> {
  lastOpenedUrl = url;
  return { type: 'opened' };
}

/** Last URL passed to `openBrowserAsync`, or `null` before the first call. */
export function __getLastOpenedUrl(): string | null {
  return lastOpenedUrl;
}

/**
 * Resets module state (recorded `openBrowserAsync` URL) so a fresh harness
 * run starts clean. Additive: the auth harness seam (`__setNextBrowserResult`,
 * `openAuthSessionAsync`) is deliberately NOT reset — test-auth.mjs owns it.
 */
export function __resetWebBrowserStub(): void {
  lastOpenedUrl = null;
}

export async function openAuthSessionAsync(
  url: string,
  redirectUrl?: string | null,
): Promise<StubWebBrowserResult> {
  void url;
  void redirectUrl;
  return nextResult;
}

export function maybeCompleteAuthSession(): {
  type: 'success' | 'failed';
  message: string;
} {
  return { type: 'success', message: '' };
}
