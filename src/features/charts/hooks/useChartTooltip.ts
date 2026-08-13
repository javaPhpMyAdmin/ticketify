/**
 * Tooltip state + touch-handler factory for the Pro charts.
 *
 * Tap-anywhere-to-show: a `<View>` wrapping the chart canvas calls
 * `attachTouchHandlers()` and spreads the returned handlers, and on
 * `onTouchStart` it computes which data point the user tapped
 * (chart-specific) and calls `tooltip.show(x, y, lines)`. The hook
 * owns the visible/hidden state and the line text — the chart owns
 * the geometry (it knows its `xKey` mapping, e.g. the trend's
 * `month` axis positions).
 *
 * The chart parent decides WHEN to dismiss. We use `onTouchEnd` plus
 * the parent's natural tap lifecycle (the tooltip stays visible while
 * the user reads it; another tap on a different data point replaces
 * the content). For explicit dismissal, the parent can pass a delay
 * to `hide()` via its own effect or simply call `hide()` when
 * navigation should fire.
 *
 * Single-tap dispatch is enough — gesture-handler is for multi-touch
 * gestures (pinch, pan), and a tap-and-hold on a chart row already
 * has its own pathway via the `Bar.onPress` we wire in `StoreBars`.
 */
import { useCallback, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';

export interface TooltipState {
  /** Whether the tooltip is currently positioned over the chart. */
  visible: boolean;
  /** X coordinate in the chart's local coordinate system (locationX). */
  x: number;
  /** Y coordinate in the chart's local coordinate system (locationY). */
  y: number;
  /** Up to 3 lines of text to render inside the popover. */
  lines: string[];
}

export interface UseChartTooltipResult {
  state: TooltipState;
  /** Show the tooltip at the given canvas-local coordinates with up to 3 lines. */
  show: (x: number, y: number, lines: string[]) => void;
  /** Hide the tooltip (used during cleanup or when the user dismisses it). */
  hide: () => void;
  /**
   * Returns handlers for `onTouchStart` and `onTouchEnd` that the parent
   * spreads on the `<View>` wrapping the chart canvas. `onTouchStart`
   * does no work by itself — the parent is expected to compute the
   * tap target (it knows its own axis mapping) and call `show(...)`
   * inside its own handler. This factory exists so the same View
   * wiring is reusable across charts.
   */
  attachTouchHandlers: () => {
    onTouchStart: (e: GestureResponderEvent) => void;
    onTouchEnd: () => void;
  };
}

const HIDDEN_STATE: TooltipState = {
  visible: false,
  x: 0,
  y: 0,
  lines: [],
};

export function useChartTooltip(): UseChartTooltipResult {
  const [state, setState] = useState<TooltipState>(HIDDEN_STATE);

  const show = useCallback((x: number, y: number, lines: string[]) => {
    const trimmed = lines.slice(0, 3);
    setState({ visible: true, x, y, lines: trimmed });
  }, []);

  const hide = useCallback(() => {
    setState((prev) => (prev.visible ? HIDDEN_STATE : prev));
  }, []);

  // The factory exposes the standard responders; the parent can attach
  // a richer `onTouchStart` (computed target) on the outer View instead
  // of these. We keep them as no-ops for now to document the contract.
  const attachTouchHandlers = useCallback(
    () => ({
      onTouchStart: () => {
        // Intentionally empty — the chart parent overrides this with
        // its own handler that knows the axis mapping.
      },
      onTouchEnd: () => {
        // Intentionally empty — the chart parent can dispatch a `hide()`
        // + navigation from its own handler (see StoreBars.onPress).
      },
    }),
    [],
  );

  return { state, show, hide, attachTouchHandlers };
}
