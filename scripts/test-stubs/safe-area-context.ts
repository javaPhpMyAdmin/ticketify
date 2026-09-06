/**
 * Test double for `react-native-safe-area-context` in the render harness.
 *
 * The real provider measures insets from the native host; the screen only
 * needs a container that renders its children (`edges` is cosmetic here).
 */
import React from 'react';

export function SafeAreaView(props: {
  children?: React.ReactNode;
  style?: unknown;
  edges?: readonly unknown[];
}): React.ReactElement {
  return React.createElement('SafeAreaView', { style: props.style }, props.children);
}