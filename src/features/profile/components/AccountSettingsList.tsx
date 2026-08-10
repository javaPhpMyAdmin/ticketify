import { StyleSheet, Switch } from 'react-native';

import {
  Card,
  Divider,
  Icon,
  Pressable,
  Text,
  View,
  type IconName,
} from '@/components';
import { colors, radii, spacing } from '@/theme';

export type SettingTrailing =
  | { type: 'switch'; value: boolean; onChange: (value: boolean) => void }
  | { type: 'chevron' }
  | { type: 'none' };

export interface AccountSettingRow {
  id: string;
  label: string;
  value?: string;
  icon: IconName;
  trailing: SettingTrailing;
  /** Opens the row's destination screen (chevron rows that navigate). */
  onPress?: () => void;
}

export interface AccountSettingsListProps {
  rows: AccountSettingRow[];
}

/**
 * The "Account Settings" card. Maps a list of declarative rows to
 * the icon / label / value / trailing-element layout used in the
 * profile screen. Switch rows are fully controlled — the current
 * value and change handler live in the row's `trailing` union.
 * Rows with an `onPress` render as a button (chevron rows that
 * navigate, e.g. "Moneda"); the rest render as plain views.
 */
export function AccountSettingsList({ rows }: AccountSettingsListProps) {
  return (
    <Card padding={spacing.xs}>
      {rows.map((row, idx) => (
        <View key={row.id}>
          {row.onPress ? (
            <Pressable
              onPress={row.onPress}
              style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={row.label}
            >
              {renderRowContent(row)}
            </Pressable>
          ) : (
            <View style={styles.row}>{renderRowContent(row)}</View>
          )}
          {idx < rows.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </Card>
  );
}

/** The icon / label / value / trailing-element content shared by every row. */
function renderRowContent(row: AccountSettingRow) {
  return (
    <>
      <View style={styles.iconBubble}>
        <Icon name={row.icon} size={18} color={colors.textPrimary} />
      </View>
      <Text style={styles.label}>{row.label}</Text>
      {row.value ? <Text style={styles.value}>{row.value}</Text> : null}
      {row.trailing.type === 'chevron' ? (
        <Icon name="chevron.right" size={18} color={colors.textSecondary} />
      ) : row.trailing.type === 'switch' ? (
        <Switch
          value={row.trailing.value}
          onValueChange={row.trailing.onChange}
          trackColor={{ true: colors.primary, false: colors.divider }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: radii.DEFAULT,
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    // ...typography.bodyLg,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  value: {
    // ...typography.bodyMd,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
