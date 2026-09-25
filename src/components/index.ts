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
export { Text, View, Icon, Logo, SplashBrandMark, GoogleG, Pressable, Spinner, Skeleton, Divider, Badge, IconButton, ToastHost, DialogHost } from './atoms';
export type {
  TextProps,
  ViewProps,
  IconProps,
  IconName,
  LogoProps,
  SplashBrandMarkProps,
  GoogleGProps,
  PressableProps,
  SpinnerProps,
  SkeletonProps,
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
  PasswordField,
  Fab,
  AmountDisplay,
  EmptyState,
  DatePickerField,
  BottomSheet,
  MonthlyBudgetCardSkeleton,
  BreakdownRowSkeleton,
  CategoryCardSkeleton,
  ReceiptRowSkeleton,
  SearchRowSkeleton,
} from './molecules';
export type {
  CardProps,
  ChipProps,
  ProgressBarProps,
  ListItemProps,
  FieldGroupProps,
  PasswordFieldProps,
  FabProps,
  AmountDisplayProps,
  EmptyStateProps,
  DatePickerFieldProps,
  BottomSheetProps,
  BottomSheetCloseIcon,
  BottomSheetKeyboardMode,
} from './molecules';

// Organisms
export {
  ReceiptRow,
  CategoryCard,
  BudgetCard,
  UsageMeter,
  ProfileHeader,
  TypedConfirmation,
} from './organisms';
export type {
  ReceiptRowProps,
  CategoryCardProps,
  BudgetCardProps,
  UsageMeterProps,
  ProfileHeaderProps,
  TypedConfirmationProps,
} from './organisms';
