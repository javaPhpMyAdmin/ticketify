/**
 * Single import surface for the design system.
 *
 *   import { Text, View, Card, Fab } from '@/components';
 *
 * Atoms are pure UI primitives; molecules compose them; organisms
 * accept domain data via props. Prefer the highest tier that fits
 * the call site. If you need feature-specific logic, use the
 * corresponding `@/features/<feature>` barrel instead.
 */

// Atoms
export { Text, View, Icon, Pressable, Spinner, Divider, Badge, IconButton } from './atoms';
export type {
  TextProps,
  ViewProps,
  IconProps,
  IconName,
  PressableProps,
  SpinnerProps,
  DividerProps,
  BadgeProps,
  IconButtonProps,
} from './atoms';

// Molecules
export {
  Card,
  Chip,
  ProgressBar,
  ListItem,
  FieldGroup,
  Fab,
  AmountDisplay,
} from './molecules';
export type {
  CardProps,
  ChipProps,
  ProgressBarProps,
  ListItemProps,
  FieldGroupProps,
  FabProps,
  AmountDisplayProps,
} from './molecules';

// Organisms
export {
  ReceiptRow,
  CategoryCard,
  BudgetCard,
  UsageMeter,
  ProfileHeader,
} from './organisms';
export type {
  ReceiptRowProps,
  CategoryCardProps,
  BudgetCardProps,
  UsageMeterProps,
  ProfileHeaderProps,
} from './organisms';
