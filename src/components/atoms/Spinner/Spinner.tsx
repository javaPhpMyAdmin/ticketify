import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';

import { colors } from '@/theme';

export type SpinnerSize = 'sm' | 'md' | 'lg' | number;

export type SpinnerProps = Omit<ActivityIndicatorProps, 'size'> & {
  /** Override the spinner color. Defaults to `colors.primary`. */
  color?: string;
  /** Convenience preset. Numbers are passed through as-is. */
  size?: SpinnerSize;
};

/**
 * Themed ActivityIndicator wrapper. Defaults to the brand primary
 * color. The `size` prop accepts `'sm' | 'md' | 'lg'` presets which
 * map to RN's `'small' | 'large'`, plus a raw `number` for custom
 * sizes — useful for inline buttons and overlays.
 */
export function Spinner({ color, size = 'md', ...rest }: SpinnerProps) {
  let resolvedSize: number | 'small' | 'large';
  if (typeof size === 'number') {
    resolvedSize = size;
  } else if (size === 'sm') {
    resolvedSize = 'small';
  } else {
    resolvedSize = 'large';
  }

  return <ActivityIndicator color={color ?? colors.primary} size={resolvedSize} {...rest} />;
}
