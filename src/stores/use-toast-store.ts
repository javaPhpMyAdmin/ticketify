/**
 * Toast state for ephemeral, non-blocking confirmations (e.g. "Cambios
 * guardados." after a receipt save). Lives outside React so a `show()`
 * call from a screen that is about to unmount (review screen → back to
 * detail) still renders the toast on the destination screen — the host
 * is mounted at the root (`src/app/_layout.tsx`) so it never unmounts
 * with the route.
 *
 * Lifetime: each `show(message)` sets the message and arms a 2s timer
 * that clears it. Successive shows cancel the previous timer so they
 * never stack — the latest message wins.
 */
import { create } from 'zustand';

/** Total visible time before the host clears the toast. */
export const TOAST_DURATION_MS = 2000;

/** Visual treatment of a toast pill. `success` paints the emerald primary. */
export type ToastVariant = 'default' | 'success';

interface ToastState {
  /** The currently-rendered message, or `null` when no toast is shown. */
  current: string | null;
  /** Visual treatment of the current toast. Defaults to the dark pill. */
  variant: ToastVariant;
  /** Show a toast for `TOAST_DURATION_MS`. Replaces any in-flight toast. */
  show: (message: string, variant?: ToastVariant) => void;
  /** Hide the toast immediately and cancel the pending timer. */
  hide: () => void;
}

// Module-scoped handle so successive `show()` calls don't stack timers —
// the second `show` must cancel the previous one's pending clear and
// restart with the new message. A store-level field would be re-created
// on every store access; a module-level ref survives the store.
let activeTimer: ReturnType<typeof setTimeout> | null = null;

function clearActiveTimer(): void {
  if (activeTimer != null) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
}

export const useToastStore = create<ToastState>((set) => ({
  current: null,
  variant: 'default',
  show: (message, variant = 'default') => {
    clearActiveTimer();
    set({ current: message, variant });
    activeTimer = setTimeout(() => {
      activeTimer = null;
      set({ current: null, variant: 'default' });
    }, TOAST_DURATION_MS);
  },
  hide: () => {
    clearActiveTimer();
    set({ current: null, variant: 'default' });
  },
}));