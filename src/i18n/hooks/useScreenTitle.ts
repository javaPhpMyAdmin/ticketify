/**
 * `useScreenTitle(key)` — micro-hook that returns the translated title
 * for a screen. Lives here so every `<Stack.Screen options={{ title }} />`
 * reads from the same `useTranslation()` factory and benefits from
 * the typed `ResourceNamespaceMap` in `types.ts`.
 *
 * Most PR 2 screens render their own visible title via a `<Text>` (the
 * settings screens own a back button + headline instead of using the
 * native Stack header). The hook exists for the cases that DO use
 * `<Stack.Screen options={{ title }} />` (see the pro screens, the
 * category drill-downs, etc.) — those passes get a translated title
 * without each one re-importing `useTranslation` separately.
 *
 * Usage:
 *
 *   import { useScreenTitle } from '@/i18n/hooks/useScreenTitle';
 *   ...
 *   const title = useScreenTitle('settings:currencyTitle');
 *   return <Stack.Screen options={{ title }} />;
 */
import { useTranslation } from 'react-i18next';

export type ScreenTitleKey =
  | 'settings:currencyTitle'
  | 'settings:monthlyBudgetTitle'
  | 'settings:exportTitle'
  | 'settings:categoryBudgetsTitle'
  | 'settings:householdTitle'
  | 'settings:language'
  | 'settings:editProfile'
  | 'tabs:home'
  | 'tabs:analytics'
  | 'tabs:history'
  | 'tabs:profile';

export function useScreenTitle(key: ScreenTitleKey): string {
  const { t } = useTranslation([
    'common',
    'tabs',
    'settings',
  ]);
  return t(key);
}