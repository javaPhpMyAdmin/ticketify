import { Platform } from 'react-native';

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';

import { useTheme } from '@/hooks/use-theme';

/**
 * We declare our own IconName union instead of importing the full
 * `SFSymbol` union so the call site is constrained to the icons this
 * app actually uses. The Material map below mirrors it for Android.
 */
export type IconName =
  | 'qr-code-scanner'
  | 'qrcode.viewfinder'
  | 'house.fill'
  | 'chart.bar.fill'
  | 'camera.fill'
  | 'calendar'
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
  | 'chevron.left'
  | 'chevron.right'
  | 'chevron.down'
  | 'photo'
  | 'arrow.up.arrow.down'
  | 'arrow.up.right'
  | 'arrow.down.right'
  | 'doc.text'
  | 'ellipsis'
  | 'checkmark'
  | 'takeoutbag.and.cup.and.straw.fill'
  | 'drop.fill'
  | 'birthday.cake.fill'
  | 'bag.fill'
  | 'fork.knife'
  | 'leaf.fill'
  | 'pills.fill'
  | 'cart.fill'
  | 'soap.fill'
  | 'bubbles.and.sparkles.fill'
  | 'waterbottle.fill'
  | 'lock.fill';

/**
 * Material icon names are a strict union from the MaterialIcons glyph map.
 * We widen to `string` here because the map is exhaustive over `IconName`
 * but TS can't infer the per-key literal type through the index access.
 */
const materialMap: Record<IconName, string> = {
  'qr-code-scanner': 'qr-code',
  'qrcode.viewfinder': 'qr-code',
  'house.fill': 'home',
  'chart.bar.fill': 'bar-chart',
  'camera.fill': 'camera-alt',
  calendar: 'calendar-month',
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
  'chevron.left': 'chevron-left',
  'chevron.right': 'chevron-right',
  'chevron.down': 'expand-more',
  photo: 'photo',
  'arrow.up.arrow.down': 'swap-vert',
  'arrow.up.right': 'trending-up',
  'arrow.down.right': 'trending-down',
  'doc.text': 'description',
  ellipsis: 'more-horiz',
  checkmark: 'check',
  'takeoutbag.and.cup.and.straw.fill': 'local-drink',
  'drop.fill': 'water-drop',
  'birthday.cake.fill': 'cake',
  'bag.fill': 'shopping-bag',
  'fork.knife': 'restaurant',
  'leaf.fill': 'eco',
  'pills.fill': 'medication',
  'cart.fill': 'shopping-cart',
  'soap.fill': 'soap',
  'bubbles.and.sparkles.fill': 'cleaning-services',
  'waterbottle.fill': 'local-drink',
  'lock.fill': 'lock',
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
    return (
      <SymbolView
        name={name as Parameters<typeof SymbolView>[0]['name']}
        size={size}
        tintColor={fill}
      />
    );
  }
  return (
    <MaterialIcons
      name={
        (materialMap[name] ?? 'help-outline') as React.ComponentProps<
          typeof MaterialIcons
        >['name']
      }
      size={size}
      color={fill}
    />
  );
}
