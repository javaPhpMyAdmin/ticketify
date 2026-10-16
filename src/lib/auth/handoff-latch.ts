/**
 * Pure transition tracker for the root layout's sign-in handoff overlay
 * (`src/app/_layout.tsx`), extracted so the #215 latch is unit-testable as a
 * SEQUENCE of renders — not just single calls (same harness pattern as
 * `decideSessionNavigation` in `src/lib/auth/session-nav.ts`).
 *
 * The overlay must outlive the frames between a session landing on the auth
 * surface and the post-paint `router.replace('/')` committing (issue #215),
 * but must NOT cover a signed-in user who merely navigates onto an auth route
 * with no session transition (the reachable dead-end the review found). This
 * reducer owns exactly that distinction: arm only on an INTERACTIVE
 * (post-bootstrap) null→session flip on the auth surface; disarm once the
 * route leaves the auth surface or the session clears.
 *
 * ZUSTAND/REACT NOTE: the layout feeds this reducer every render and applies
 * the returned `latched` via a render-phase `setState` (React's documented
 * "adjusting state during render" pattern), so the arm is already in effect
 * on the very commit the session lands — no post-paint gap.
 */

export interface HandoffState {
  /** True while an armed handoff has not yet left the auth surface. */
  latched: boolean;
}

/** The latch never starts armed (a fresh mount is not a handoff). */
export const INITIAL_HANDOFF_STATE: HandoffState = { latched: false };

export interface HandoffInput {
  /** True on the render where the session was null on the previous render. */
  prevSessionWasNull: boolean;
  /** True when the session store currently holds a session. */
  hasSession: boolean;
  /** True when the route is on the auth surface (sign-in group, not reset). */
  onAuthSurface: boolean;
  /** True while the launch session restore is still running. */
  isBootstrapping: boolean;
}

/**
 * Advance the handoff latch by one render. Pure: same `(state, input)` always
 * returns the same next state.
 *
 * NOTE (cold-start dependency): the `!isBootstrapping` arm guard assumes the
 * store emits `set({ session })` and `set({ isBootstrapping: false })` in
 * SEPARATE renders (see `use-session-store.ts` restore). If a future refactor
 * coalesced them, the restore flip would look interactive; see the arm-site
 * comment in `_layout.tsx`.
 */
export function reduceHandoff(state: HandoffState, input: HandoffInput): HandoffState {
  const { prevSessionWasNull, hasSession, onAuthSurface, isBootstrapping } = input;
  const flipDetectedThisRender = prevSessionWasNull && hasSession;
  // No session → nothing to cover.
  if (!hasSession) return { latched: false };
  // Left the auth surface → the handoff is over.
  if (!onAuthSurface) return { latched: false };
  // Interactive (post-bootstrap) flip on the auth surface → arm.
  if (!isBootstrapping && flipDetectedThisRender) return { latched: true };
  // Otherwise hold the current latch (armed across the pre-commit frames;
  // false for the navigated-in / deep-link case, which never flipped).
  return state;
}
