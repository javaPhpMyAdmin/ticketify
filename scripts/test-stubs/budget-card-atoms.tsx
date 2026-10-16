/**
 * Minimal test double for `@/components/atoms` used by the
 * budget-currency-mismatch harness (scripts/test-budget-currency-mismatch.mjs).
 *
 * `BudgetCard` imports `Text` / `View` from the atoms barrel at runtime, so
 * this stub renders host elements that pass `children` through. A
 * react-test-renderer walk then keeps the visible strings (the percent text,
 * the clarification copy) reachable for assertions.
 */
import React from 'react';

export type IconName = string;

export interface TextProps {
  children?: React.ReactNode;
  numberOfLines?: number;
  style?: unknown;
}

export function Text(props: TextProps): React.ReactElement {
  return React.createElement('Text', null, props.children);
}

export interface ViewProps {
  children?: React.ReactNode;
  style?: unknown;
}

export function View(props: ViewProps): React.ReactElement {
  return React.createElement('View', null, props.children);
}
