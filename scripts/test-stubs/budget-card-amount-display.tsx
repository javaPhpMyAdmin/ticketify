/**
 * Test double for `@/components/molecules/AmountDisplay` in the
 * budget-currency-mismatch harness.
 *
 * The real molecule formats through `@/lib/format` behind a currency-symbol
 * gate that the harness never opens, which would make a rendered-symbol
 * assertion flaky. This stub instead renders a host `AmountDisplay` element
 * carrying the exact `value` / `currency` it was handed — so the harness pins
 * WHICH unit the big number was bound to (the whole point of issue #214)
 * without depending on formatter state.
 */
import React from 'react';

export interface AmountDisplayProps {
  value: number;
  currency?: string;
  negative?: boolean;
  small?: boolean;
  style?: unknown;
}

export function AmountDisplay(props: AmountDisplayProps): React.ReactElement {
  return React.createElement(
    'AmountDisplay',
    { value: props.value, currency: props.currency },
    `${props.value}|${props.currency}`,
  );
}
