/**
 * Test double for `react-native` (auth harness). The real package cannot load
 * in plain node (flow syntax). The app code under test only touches
 * `AppState` (focus wiring in `query-client.ts`) and `Platform.OS`; the stub
 * exposes a no-op listener registration so the compiled module runs.
 */
export type AppStateStatus =
  | 'active'
  | 'background'
  | 'inactive'
  | 'unknown'
  | 'extension';

/** Loose stand-in for RN's TextStyle (compiled consumers only spread it). */
export type TextStyle = Record<string, unknown>;

export const Platform = {
  OS: 'ios',
  select: <T>(spec: Record<string, T> & { default?: T }): T | undefined =>
    spec[Platform.OS] ?? spec.default,
};

export const AppState = {
  addEventListener(
    _type: 'change',
    _listener: (state: AppStateStatus) => void,
  ): { remove: () => void } {
    return { remove: () => {} };
  },
};

// --- Drill-down screen surface -----------------------------------------
// The category drill-down imports Pressable/ScrollView/StyleSheet from
// 'react-native'. The stub renders Pressable/ScrollView as host elements
// (children pass through) so react-test-renderer can walk and assert the
// tree; StyleSheet.create is identity (styles are inert at runtime).

import React from 'react';

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
};

export function Pressable(props: {
  children?: React.ReactNode;
  onPress?: () => void;
  hitSlop?: number | Record<string, number>;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  style?: unknown;
}): React.ReactElement {
  return React.createElement(
    'Pressable',
    { onPress: props.onPress, accessibilityLabel: props.accessibilityLabel },
    props.children,
  );
}

export function ScrollView(props: {
  children?: React.ReactNode;
  contentContainerStyle?: unknown;
  showsVerticalScrollIndicator?: boolean;
  keyboardShouldPersistTaps?: string;
}): React.ReactElement {
  return React.createElement('ScrollView', null, props.children);
}

// --- Settings screen surface (budget-month-local harness, compile-only) ---
// The settings screen imports KeyboardAvoidingView / TextInput from
// 'react-native'. The harness never executes the compiled screen (it only
// greps its output), so these exist purely to satisfy the typecheck.

export function KeyboardAvoidingView(props: {
  children?: React.ReactNode;
  behavior?: 'height' | 'position' | 'padding';
  style?: unknown;
}): React.ReactElement {
  return React.createElement('KeyboardAvoidingView', null, props.children);
}

export function TextInput(props: {
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  keyboardType?: string;
  inputMode?: string;
  maxLength?: number;
  placeholderTextColor?: string;
  editable?: boolean;
  accessibilityLabel?: string;
  style?: unknown;
}): React.ReactElement {
  return React.createElement('TextInput');
}
