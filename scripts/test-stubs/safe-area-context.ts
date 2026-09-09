/**
 * Test double for `react-native-safe-area-context` in the budget-month-local
 * harness (compile-only: the harness greps the compiled settings output, it
 * never executes the screen).
 *
 * The real package's `SafeAreaView` typing in this version does not surface
 * `style`, which breaks the settings screen's compile; this stub accepts the
 * props the screen actually passes (children, style, edges).
 */
import React from 'react';

export function SafeAreaView(props: {
  children?: React.ReactNode;
  style?: unknown;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}): React.ReactElement {
  return React.createElement('SafeAreaView', null, props.children);
}

export function useSafeAreaInsets(): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  return { top: 0, bottom: 0, left: 0, right: 0 };
}