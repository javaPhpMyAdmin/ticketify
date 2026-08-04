import { Platform } from 'react-native';

import { SymbolView } from 'expo-symbols';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { useTheme } from '@/hooks/use-theme';

/**
 * We declare our own IconName union instead of importing the full
 * `SFSymbol` union so the call site is constrained to the icons this
 * app actually uses. The Material map below mirrors it for Android.
 */
export type IconName =
  | 'house.fill'
  | 'chart.bar.fill'
  | 'camera.fill'
  | 'clock.fill'
  | 'person.fill'
  | 'plus'
  | 'xmark'
  | 'bolt.fill'
  | 'magnifyingglass'
  | 'arrow.left'
  | 'gearshape'
  | 'square.and.arrow.up'
  | 'creditcard'
  | 'sparkles'
  | 'exclamationmark.triangle.fill'
  | 'chevron.right'
  | 'chevron.down'
  | 'photo'
  | 'arrow.up.arrow.down'
  | 'doc.text'
  | 'ellipsis'
  | 'checkmark';

/**
 * Material icon names are a strict union from the MaterialIcons glyph map.
 * We widen to `string` here because the map is exhaustive over `IconName`
 * but TS can't infer the per-key literal type through the index access.
 */
const materialMap: Record<IconName, string> = {
  'house.fill': 'home',
  'chart.bar.fill': 'bar-chart',
  'camera.fill': 'camera-alt',
  'clock.fill': 'history',
  'person.fill': 'person',
  plus: 'add',
  xmark: 'close',
  'bolt.fill': 'bolt',
  magnifyingglass: 'search',
  'arrow.left': 'arrow-back',
  gearshape: 'settings',
  'square.and.arrow.up': 'share',
  creditcard: 'credit-card',
  sparkles: 'auto-awesome',
  'exclamationmark.triangle.fill': 'warning',
  'chevron.right': 'chevron-right',
  'chevron.down': 'expand-more',
  photo: 'photo',
  'arrow.up.arrow.down': 'swap-vert',
  'doc.text': 'description',
  ellipsis: 'more-horiz',
  checkmark: 'check',
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 22, color }: IconProps) {
  const theme = useTheme();
  const fill = color ?? theme.textPrimary;
  if (Platform.OS === 'ios') {
    // `name` is a literal string that happens to be a valid SFSymbol;
    // we accept the cast here because IconName is a curated subset.
    return <SymbolView name={name as Parameters<typeof SymbolView>[0]['name']} size={size} tintColor={fill} />;
  }
  return <MaterialIcons name={(materialMap[name] ?? 'help-outline') as React.ComponentProps<typeof MaterialIcons>['name']} size={size} color={fill} />;
}
