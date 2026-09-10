import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';

import { colors } from '@/theme';

const emerald = colors.primary;

export default function TabsLayout() {
  // Loading both namespaces so `t('tabs.home')` resolves to the
  // dedicated `tabs` namespace (the `t` parser treats the first dot
  // segment as a namespace prefix when it matches a loaded ns).
  const { t } = useTranslation(['common', 'tabs']);

  return (
    <NativeTabs
      tintColor={emerald}
      backgroundColor={colors.background}
      indicatorColor={colors.surfaceDim}
      iconColor={{ default: colors.textSecondary, selected: emerald }}
      labelStyle={{
        default: { fontSize: 11, fontWeight: '600' },
        selected: {
          fontSize: 15,
          fontWeight: '800',
        },
      }}
    >
      <NativeTabs.Trigger name="index">
        <Label>{t('tabs:home')}</Label>
        <Icon sf="house.fill" drawable="ic_menu_home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="analytics">
        <Label>{t('tabs:analytics')}</Label>
        <Icon sf="chart.bar.fill" drawable="ic_menu_sort_by_size" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <Label>{t('tabs:history')}</Label>
        <Icon sf="clock.fill" drawable="ic_menu_recent_history" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <Label>{t('tabs:profile')}</Label>
        <Icon sf="person.fill" drawable="ic_menu_myplaces" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
