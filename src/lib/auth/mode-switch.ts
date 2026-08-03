/**
 * Pure decision logic for the profile screen's mode switch (demo-mode spec).
 *
 * The profile "Data Source" rows let the user move between demo fixtures and
 * the authenticated app. The spec-critical branch is the authenticated row:
 *   - signed out → present the sign-in flow (mode stays demo, so the root
 *     gate keeps showing the tabs and the user returns to fixtures on back),
 *   - signed in  → promote the mode; feature reads switch to Supabase data.
 *
 * Keeping this in a pure function (instead of inline in the screen) lets the
 * node harness cover the spec scenarios without React test infrastructure.
 */
export type AuthenticatedSwitchAction = 'promote' | 'sign-in';

/**
 * What pressing "Authenticated" in the mode switch should do, given whether a
 * session exists. `'promote'` flips the store mode to `'authenticated'`;
 * `'sign-in'` navigates to the sign-in screen and leaves the mode unchanged.
 */
export function authenticatedSwitchAction(
  hasSession: boolean,
): AuthenticatedSwitchAction {
  return hasSession ? 'promote' : 'sign-in';
}

/** The side effects the profile screen injects into `handleAuthenticatedPress`. */
export interface AuthenticatedPressDeps {
  /** Whether a session exists — the Authenticated row's decision input. */
  hasSession: boolean;
  /** Signed in: promotes the mode; feature reads switch to Supabase data. */
  promote: () => void;
  /** Signed out: opens the sign-in flow; the mode stays demo (back → fixtures). */
  navigateToSignIn: () => void;
}

/**
 * The profile screen's Authenticated-row handler, extracted so the node
 * harness can exercise the REAL wiring — not just `authenticatedSwitchAction`
 * — without a React renderer. `profile.tsx` delegates its onPress here, so
 * this is exactly the decision the shipped screen runs:
 *   - signed out → `navigateToSignIn()` only: the mode is untouched, the gate
 *     stays open, and back returns to the fixture app,
 *   - signed in  → `promote()` only: no gate flash, reads switch to Supabase.
 */
export function handleAuthenticatedPress(deps: AuthenticatedPressDeps): void {
  if (authenticatedSwitchAction(deps.hasSession) === 'promote') {
    deps.promote();
  } else {
    deps.navigateToSignIn();
  }
}
