/**
 * Pure decision for the root layout's sign-in handoff overlay
 * (`src/app/_layout.tsx`), extracted so the overlay contract is
 * unit-testable without expo-router or React (same harness pattern as
 * `decideSessionNavigation` in `src/lib/auth/session-nav.ts`).
 *
 * The overlay is the opaque, root-mounted surface that covers the Stack
 * while the app transitions between "signed out" and "signed in" but the
 * navigator has not committed the destination route yet.
 *
 * It covers TWO windows:
 *
 * 1. OAuth provider handoff (#206): after the OS browser returns from
 *    Google, `session` stays null until the PKCE code exchange resolves
 *    (~1s). `authFlowInFlight` is the reactive flag for exactly that
 *    window — no session, flow running, bootstrap already done.
 *
 * 2. Session handoff (#215): the gate
 *    `<Stack.Protected guard={session != null}>` only adds/removes screens,
 *    it does NOT navigate. Navigation to `(tabs)` is a post-paint effect
 *    (`router.replace('/')` in `_layout.tsx`), so there are frames between
 *    the session landing and the route committing to `(tabs)`. When the
 *    session FLIPS from null while the route is on the auth surface, the
 *    overlay must stay up across those frames.
 *
 *    Crucially, "signed in on an auth route" is NOT the handoff. A signed-in
 *    user can REACH `/sign-in` with no transition — the `/legal/*` footer
 *    (`LegalScreen` `router.replace('/sign-in')`) reached from the signed-in
 *    profile, or a `ticketify://sign-in` deep link. `decideSessionNavigation`
 *    never navigates there (no null→session flip, not `/oauth`), so an
 *    overlay gated on `hasSession && onAuthSurface` alone would be a
 *    permanent, affordance-less cover (a hard dead-end — worse than the soft
 *    dead-end the route already is). The overlay is therefore bounded to the
 *    TRANSITION: it shows only while `flipDetectedThisRender || handoffLatched`
 *    holds, and the latch disarms once the route leaves the auth surface.
 *
 * The launch boot window (`isBootstrapping`) is NOT the overlay's job:
 * `BootSplash` owns it (its condition is deliberately untouched), so the
 * overlay is suppressed for the whole bootstrap.
 */

/** The inputs the overlay decision depends on. */
export interface AuthOverlayInput {
  /** True when the session store currently holds a session. */
  hasSession: boolean;
  /** The current expo-router pathname. */
  pathname: string;
  /** True while the OAuth provider flow is running (post-browser handoff). */
  authFlowInFlight: boolean;
  /** True while the launch session restore is still running. */
  isBootstrapping: boolean;
  /**
   * True on the exact render where the session flipped null → session. The
   * caller derives it from its `prevSession` ref, which is updated in a
   * post-paint effect — so it is still null on the landing render.
   */
  flipDetectedThisRender: boolean;
  /**
   * True while an armed handoff has not yet left the auth surface. The
   * caller arms it on the flip and disarms it once the route is off the auth
   * surface; it is what covers the frame(s) between the landing render and
   * the `router.replace('/')` committing.
   */
  handoffLatched: boolean;
}

/**
 * Pathnames of the `(auth)` route group that the root session effect
 * navigates AWAY from once a session lands — i.e. routes where a session
 * must never be rendered uncovered.
 *
 * `/reset-password` is DELIBERATELY excluded: the recovery exchange signs
 * the user in with a recovery session *before* they pick a new password, so
 * the screen stays on `/reset-password` with a live session by design
 * (`decideSessionNavigation` suppresses both of its clauses there). It owns
 * its own exit; covering it would make the new-password form unreachable.
 *
 * Written as an explicit list (not `pathname.startsWith('/sign')`) so it can
 * never accidentally cover a future unrelated route or the `/oauth` callback
 * screen — which is outside the `(auth)` group, renders its own wait UI, and
 * is navigated away from by the layout's parked clause.
 */
const AUTH_SURFACE_ROUTES: ReadonlySet<string> = new Set([
  '/sign-in',
  '/sign-up',
  '/forgot-password',
]);

/** True when `pathname` is an `(auth)` route the session effect leaves. */
export function isAuthSurfacePathname(pathname: string): boolean {
  return AUTH_SURFACE_ROUTES.has(pathname);
}

/**
 * The root layout's single overlay-visibility gate. A frame with
 * `hasSession === true` that is part of the session handoff may never render
 * with the overlay hidden (issue #215); every pre-existing condition is
 * preserved, and the handoff branch is bounded to the transition so a
 * signed-in user who merely navigates onto an auth route is never trapped.
 */
export function shouldShowAuthOverlay({
  hasSession,
  pathname,
  authFlowInFlight,
  isBootstrapping,
  flipDetectedThisRender,
  handoffLatched,
}: AuthOverlayInput): boolean {
  // Boot owns its own window: BootSplash covers the launch until the
  // stored session reconciles; the overlay never competes with it.
  if (isBootstrapping) return false;
  // Pre-existing #206 window: no session yet, provider flow running.
  if (!hasSession) return authFlowInFlight;
  // #215 handoff ONLY: a session on the auth surface is covered iff this is
  // the transition (the flip render, or an armed latch not yet released).
  // A signed-in render with no transition (navigated-in / deep link) is NOT
  // the handoff and must fall through to the soft, uncovered behaviour.
  if (!isAuthSurfacePathname(pathname)) return false;
  return flipDetectedThisRender || handoffLatched;
}
