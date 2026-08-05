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
        <Label>Home</Label>
        <Icon sf="house.fill" drawable="ic_menu_home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="analytics">
        <Label>Analytics</Label>
        <Icon sf="chart.bar.fill" drawable="ic_menu_sort_by_size" />
      </NativeTabs.Trigger>


      <NativeTabs.Trigger name="history">
        <Label>History</Label>
        <Icon sf="clock.fill" drawable="ic_menu_recent_history" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <Label>Profile</Label>
        <Icon sf="person.fill" drawable="ic_menu_myplaces" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
