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
  | 'trash'
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
  | 'arrow.right'
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
  | 'lock.fill'
  | 'chart.pie.fill'
  | 'pencil'
  | 'doc.on.doc'
  | 'person.badge.plus'
  | 'rectangle.portrait.and.arrow.right'
  | 'globe'
  // ── Paywall (Kinetic Finance rewrite) ──────────────────────────
  // SF Symbol names mapped to MaterialIcons glyphs for the visual
  // elements unique to the pro paywall screen. Adding new names here
  // is the supported extension point — both the SF Symbol on iOS
  // and the MaterialIcons glyph on Android are wired through the
  // `materialMap` table below.
  | 'star.fill'
  | 'receipt'
  | 'checkmark.seal.fill'
  | 'chart.line.uptrend.xyaxis'
  | 'doc.viewfinder'
  | 'chart.bar.xaxis'
  | 'arrow.down.circle'
  | 'bell.badge.fill'
  | 'person.3.fill'
  | 'flame.fill'
  | 'calendar.badge.checkmark'
  // ── Onboarding (first-launch wizard) ─────────────────────────────────
  // SF Symbol names mapped to MaterialIcons glyphs for the kinetic-
  // finance 3-step welcome flow. Following the paywall-polish commit
  // convention (icon names added to IconName + the Material map below;
  // existing names left unchanged).
  | 'receipt_long'
  | 'arrow_back'
  | 'arrow_forward'
  | 'person'
  | 'auto_awesome'
  | 'shopping_cart'
  | 'verified'
  | 'check_circle'
  | 'magic_button'
  | 'query_stats'
  | 'trending_down'
  | 'trending_up'
  | 'celebration'
  | 'bolt'
  // ── Auth (form UX) ─────────────────────────────────────────────────
  // Password visibility toggle on the sign-in/sign-up forms: SF Symbol
  // names mapped to MaterialIcons glyphs (see materialMap below).
  | 'eye'
  | 'eye.slash';

/**
 * Material icon names are a strict union from the MaterialIcons glyph map.
 * We widen to `string` here because the map is exhaustive over `IconName`
 * but TS can't infer the per-key literal type through the index access.
 */
const materialMap: Record<IconName, string> = {
  trash: 'delete',
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
  'arrow.right': 'arrow-forward',
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
  'chart.pie.fill': 'pie-chart',
  pencil: 'edit',
  'doc.on.doc': 'content-copy',
  'person.badge.plus': 'person-add',
  'rectangle.portrait.and.arrow.right': 'logout',
  globe: 'public',
  // Paywall (Kinetic Finance rewrite) — see IconName for rationale.
  'star.fill': 'star',
  receipt: 'receipt-long',
  'checkmark.seal.fill': 'verified',
  'chart.line.uptrend.xyaxis': 'trending-up',
  'doc.viewfinder': 'document-scanner',
  'chart.bar.xaxis': 'insights',
  'arrow.down.circle': 'cloud-download',
  'bell.badge.fill': 'notification-important',
  'person.3.fill': 'family-restroom',
  'flame.fill': 'local-fire-department',
  'calendar.badge.checkmark': 'event-available',
  // Onboarding (first-launch wizard) — see IconName for the rationale
  // and the commit convention. Names map to the SF Symbol-style name
  // on iOS via SymbolView and to the MaterialIcons glyph on Android.
  receipt_long: 'receipt-long',
  arrow_back: 'arrow-back',
  arrow_forward: 'arrow-forward',
  person: 'person',
  auto_awesome: 'auto-awesome',
  shopping_cart: 'shopping-cart',
  verified: 'verified',
  check_circle: 'check-circle',
  magic_button: 'auto-fix-high',
  query_stats: 'query-stats',
  trending_down: 'trending-down',
  trending_up: 'trending-up',
  celebration: 'celebration',
  bolt: 'bolt',
  // Auth (form UX) — see IconName for the rationale.
  eye: 'visibility',
  'eye.slash': 'visibility-off',
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
