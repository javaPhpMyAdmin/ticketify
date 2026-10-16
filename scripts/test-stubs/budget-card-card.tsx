/**
 * Test double for `@/components/molecules/Card` in the
 * budget-currency-mismatch harness. Renders a host `Card` element with the
 * children passed through so the react-test-renderer walk can reach the
 * card's visible text.
 */
import React from 'react';

export interface CardProps {
  children?: React.ReactNode;
  padding?: unknown;
  style?: unknown;
}

export function Card(props: CardProps): React.ReactElement {
  return React.createElement('Card', null, props.children);
}
