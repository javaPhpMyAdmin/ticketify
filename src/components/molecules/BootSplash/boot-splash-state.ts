/**
 * Pure, framework-free state machine for the branded boot splash.
 *
 * States:  visible  →  fading  →  done (terminal)
 *
 * The 900ms minimum-display timer lives OUTSIDE this reducer (the caller
 * keeps it running and dispatches `booted` with `minDisplayElapsed: true`
 * only once the timer expires). The reducer itself never models time.
 */

export type BootSplashState = 'visible' | 'fading' | 'done';

export type BootSplashEvent =
  | { type: 'booted'; minDisplayElapsed: boolean }
  | { type: 'fadeCompleted'; finished: boolean };

/**
 * Deterministic pure reducer. Given a state and an event, returns the
 * next state. The reducer is side-effect-free and idempotent for the
 * same inputs, which makes table-driven asserts trivial.
 *
 * Contracts:
 * - `done` is terminal: all subsequent events are ignored.
 * - `visible` → `fading` only via `booted` with `minDisplayElapsed: true`.
 *   The pending 900ms timer is the caller's responsibility.
 * - `fading` → `done` only via `fadeCompleted` with `finished: true`.
 * - `fadeCompleted` with `finished: false` does nothing (fade is still
 *   in progress or the animation was interrupted).
 * - `onFinish` fires at most once: the reducer reaches `done` at most
 *   once (entry is unique), so the caller can call `onFinishRef.current?.()`
 *   unconditionally on the transition.
 * - There is no reset event: a parent re-render cannot reset the splash
 *   to `visible` because the reducer has no such event type.
 */
export function bootSplashState(
  state: BootSplashState,
  event: BootSplashEvent,
): BootSplashState {
  if (state === 'done') return state;

  switch (state) {
    case 'visible':
      if (event.type === 'booted' && event.minDisplayElapsed) return 'fading';
      return state;

    case 'fading':
      if (event.type === 'fadeCompleted' && event.finished) return 'done';
      return state;

    default:
      return state;
  }
}
