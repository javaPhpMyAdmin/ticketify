/**
 * Motion tokens — the single source of truth for press feedback.
 *
 * Every tappable surface in the app renders through the themed `Pressable`
 * atom (`src/components/atoms/Pressable`), which reads these tokens instead
 * of re-declaring opacity / scale literals at the call site. Two reasons the
 * tokens live here rather than next to the atom:
 *
 *   1. A consumer that needs a DIFFERENT press treatment (a denser scale for
 *      a grid cell, a tonal shift with no scale at all for a floating action
 *      button) composes a token rather than inventing a number, so the design
 *      system's "active states" stay legible in one place.
 *   2. They are data, not behavior: the atom owns WHEN a token applies, this
 *      module only owns WHAT it is. `motion.ts` imports nothing at runtime.
 *
 * Note the deliberate type split, because the two kinds of token are consumed
 * differently:
 *   - `pressScale` is a bare NUMBER — a transform has to be composed
 *     (`{ transform: [{ scale }] }`) by whoever applies it, and the atom takes
 *     the factor as a prop.
 *   - `pressDim` / `disabledDim` / `pressScaleStrong` are `ViewStyle`
 *     fragments — opacity and transform are whole-style properties, so the
 *     consumer splices them straight into a style array.
 */
import type { ViewStyle } from 'react-native';

export interface MotionTokens {
  /**
   * Default press scale factor. The atom applies
   * `{ transform: [{ scale: pressScale }] }` while held unless a caller
   * overrides `pressScale`.
   */
  pressScale: number;
  /** Opacity applied while a pressable is held. */
  pressDim: ViewStyle;
  /** Opacity applied while a pressable is disabled. */
  disabledDim: ViewStyle;
  /**
   * Stronger press scale for dense, tappable targets (picker grid cells,
   * confirm buttons) where the default sink is too soft to read.
   */
  pressScaleStrong: ViewStyle;
}

export const motion: MotionTokens = {
  pressScale: 0.98,
  pressDim: { opacity: 0.7 },
  disabledDim: { opacity: 0.5 },
  pressScaleStrong: { transform: [{ scale: 0.97 }] },
};