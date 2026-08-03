import { View as RNView, type ViewProps as RNViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ViewProps = RNViewProps & {
  /** Theme color token used as the background. Defaults to `background`. */
  themeColor?: ThemeColor;
};

export function View({ style, themeColor, ...otherProps }: ViewProps) {
  const theme = useTheme();

  return <RNView style={[{ backgroundColor: theme[themeColor ?? 'background'] }, style]} {...otherProps} />;
}
