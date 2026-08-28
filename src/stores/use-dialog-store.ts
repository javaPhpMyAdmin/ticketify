/**
 * Dialog state for styled, centered confirm/alert dialogs — the custom
 * replacement for native `Alert.alert` (native alerts are visually poor;
 * the user chose a centered dialog over a bottom sheet, which has proven
 * buggy with animations in this codebase).
 *
 * Lives outside React, mirroring `use-toast-store`, so a `show()` call
 * from any screen — even right before a `router.back()` or unmount —
 * still renders: the host is mounted once at the root
 * (`src/app/_layout.tsx`) and never unmounts with the route.
 *
 * Two deliberate differences from the toast store, driven by the dialog's
 * blocking nature:
 *
 * - Dialogs NEVER auto-dismiss on a timer: they require explicit user
 *   action on a button (or the Android hardware back button).
 * - `hide()` keeps the last `options` in state instead of clearing them,
 *   so the host can keep rendering the card content during the fade-out;
 *   the next `show()` replaces them.
 *
 * Button semantics mirror native alerts: pressing a button dismisses the
 * dialog first, THEN runs that button's callback (host-driven, so callers
 * never call `hide()` themselves).
 */
import { create } from 'zustand';

/** Paints the primary button. `danger` = destructive actions. */
export type DialogTone = 'default' | 'danger';

export interface DialogOptions {
  /** Card title (bold). */
  title: string;
  /** Optional body copy under the title. */
  message?: string;
  /** Filled CTA label. Painted with `colors.danger` when `tone === 'danger'`. */
  primaryLabel: string;
  /** Runs after the dialog hides, when the primary button is pressed. */
  onPrimary?: () => void;
  /** Optional outlined dismiss CTA label. Omit for single-action dialogs. */
  secondaryLabel?: string;
  /** Runs after the dialog hides, when the secondary button is pressed. */
  onSecondary?: () => void;
  /** Visual treatment of the primary button. Defaults to `'default'`. */
  tone?: DialogTone;
}

interface DialogState {
  /** True while a dialog is on screen (or animating out). */
  visible: boolean;
  /**
   * The currently-displayed dialog content. Kept after `hide()` so the
   * host can render the card during the fade-out; replaced by the next
   * `show()`.
   */
  options: DialogOptions | null;
  /** Show a dialog with the given options. Replaces any open dialog. */
  show: (options: DialogOptions) => void;
  /** Hide the dialog immediately (fade-out). */
  hide: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  visible: false,
  options: null,
  show: (options) => set({ visible: true, options }),
  hide: () => set({ visible: false }),
}));