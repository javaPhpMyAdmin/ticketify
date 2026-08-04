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

export function __setNextBrowserResult(result: StubWebBrowserResult): void {
  nextResult = result;
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
