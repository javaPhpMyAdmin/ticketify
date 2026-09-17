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

/**
 * Visual treatment of a row. `default` is the standard neutral treatment;
 * `danger` paints the icon tint and label with `colors.danger` so the row
 * is visually distinct (used by the "Eliminar cuenta" entry on the
 * profile screen — design §9).
 */
export type AccountSettingRowTone = 'default' | 'danger';

export interface AccountSettingRow {
  id: string;
  label: string;
  value?: string;
  icon: IconName;
  trailing: SettingTrailing;
  /** Opens the row's destination screen (chevron rows that navigate). */
  onPress?: () => void;
  /**
   * Visual treatment of the row. Defaults to `'default'` — every existing
   * row omits the prop and renders unchanged. `danger` is reserved for
   * destructive actions (e.g. "Eliminar cuenta") that need to read as
   * a "danger zone" affordance without changing the row's layout.
   */
  tone?: AccountSettingRowTone;
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
  const isDanger = row.tone === 'danger';
  const accent = isDanger ? colors.danger : colors.textPrimary;
  return (
    <>
      <View style={styles.iconBubble}>
        <Icon name={row.icon} size={18} color={accent} />
      </View>
      <Text style={[styles.label, isDanger && { color: colors.danger }]}>
        {row.label}
      </Text>
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
