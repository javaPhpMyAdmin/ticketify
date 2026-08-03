/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  // `scheme` is 'light' | 'dark' | null | undefined on RN.
  const key = scheme === 'dark' || scheme === 'light' ? scheme : 'light';
  return Colors[key];
}
