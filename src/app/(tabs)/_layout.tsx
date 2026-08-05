import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

import { colors } from '@/theme';

const emerald = colors.primary;

export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={emerald}
      iconColor={{ default: colors.textSecondary, selected: emerald }}
      labelStyle={{ fontSize: 11, fontWeight: '600' }}
    >
      <NativeTabs.Trigger name="index">
        <Label>Inicio</Label>
        <Icon sf="house.fill" drawable="ic_menu_home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="analytics">
        <Label>Analítica</Label>
        <Icon sf="chart.bar.fill" drawable="ic_menu_sort_by_size" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <Label>Historial</Label>
        <Icon sf="clock.fill" drawable="ic_menu_recent_history" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <Label>Perfil</Label>
        <Icon sf="person.fill" drawable="ic_menu_myplaces" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
