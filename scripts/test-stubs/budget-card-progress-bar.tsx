/**
 * Test double for `@/components/molecules/ProgressBar` in the
 * budget-currency-mismatch harness.
 *
 * Renders a distinctive host `ProgressBar` element carrying its `value`. That
 * makes "the progress bar is absent in the currency-mismatch state" a crisp,
 * non-flaky assertion (`findAllByType('ProgressBar').length === 0`) instead of
 * a fragile scan of nested `View` styles.
 */
import React from 'react';

export interface ProgressBarProps {
  value: number;
  color?: string;
  height?: number;
  trackColor?: string;
  accessibilityLabel?: string;
}

export function ProgressBar(props: ProgressBarProps): React.ReactElement {
  return React.createElement('ProgressBar', { value: props.value });
}
