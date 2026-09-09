/**
 * Test double for `@/components` in the home-feed + drill-down harnesses.
 *
 * The home-feed modules only ever import `IconName` from it as a TYPE (the
 * compiled CommonJS output erases the import). The drill-down SCREEN
 * (`src/app/categories/[key].tsx`) imports it at RUNTIME — Divider,
 * EmptyState, Icon, Text, View — so this stub also renders minimal host
 * elements that pass `children` through. React-test-renderer then walks
 * the host tree, and `toJSON()` keeps the text reachable for assertions
 * ("Cargando datos del hogar…", "Sin gastos…", "Reintentar", formatted
 * totals…).
 */
import React from 'react';

export type IconName = string;

export interface TextProps {
  children?: React.ReactNode;
  numberOfLines?: number;
  style?: unknown;
}

export function Text(props: TextProps): React.ReactElement {
  return React.createElement('Text', { numberOfLines: props.numberOfLines }, props.children);
}

export interface ViewProps {
  children?: React.ReactNode;
  style?: unknown;
}

export function View(props: ViewProps): React.ReactElement {
  return React.createElement('View', { style: props.style }, props.children);
}

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon(props: IconProps): React.ReactElement {
  return React.createElement('Icon', { name: props.name, size: props.size });
}

export function Divider(): React.ReactElement {
  return React.createElement('Divider');
}

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  framed?: boolean;
}

/**
 * Renders the EmptyState contract the screen relies on: a title, optional
 * body, and an optional action rendered as a pressable labeled by
 * `actionLabel`. The harness can find that pressable (its flattened text is
 * `actionLabel`) and invoke `onAction` to exercise retry-through-the-UI.
 */
export function EmptyState(props: EmptyStateProps): React.ReactElement {
  return React.createElement(
    'EmptyState',
    null,
    props.icon ? React.createElement(Icon, { name: props.icon, size: 40 }) : null,
    props.title ? React.createElement(Text, null, props.title) : null,
    props.body ? React.createElement(Text, null, props.body) : null,
    props.actionLabel && props.onAction
      ? React.createElement(
          'Pressable',
          { onPress: props.onAction, accessibilityRole: 'button' },
          React.createElement(Text, null, props.actionLabel),
        )
      : null,
  );
}

// --- Settings screen surface (budget-month-local harness, compile-only) ---
// The settings screen imports Card / Pressable / Spinner from '@/components'.
// The harness never executes the compiled screen (it only greps its output),
// so these stubs exist purely to satisfy the typecheck.

export interface PressableProps {
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  hitSlop?: number | Record<string, number>;
  style?: unknown | ((state: { pressed: boolean }) => unknown);
  accessibilityRole?: string;
  accessibilityLabel?: string;
}

export function Pressable(props: PressableProps): React.ReactElement {
  return React.createElement('Pressable', null, props.children);
}

export interface CardProps {
  children?: React.ReactNode;
  padding?: unknown;
  style?: unknown;
}

export function Card(props: CardProps): React.ReactElement {
  return React.createElement('Card', null, props.children);
}

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}

export function Spinner(props: SpinnerProps): React.ReactElement {
  return React.createElement('Spinner');
}