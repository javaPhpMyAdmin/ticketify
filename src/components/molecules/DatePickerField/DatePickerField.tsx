import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/atoms';
import { BottomSheet } from '@/components/molecules/BottomSheet';
import { colors, radii, spacing, typography } from '@/theme';

import { todayLocalISO } from '@/lib/format';
import {
  fullMonthES,
  isoFromParts,
  isFutureISO,
  monthGrid,
  pad2,
  partsFromISO,
  weekdayLabels,
} from './calendar';

export interface DatePickerFieldProps {
  /** Whether the sheet is open. Kept mounted so closing animates (modal pattern). */
  visible: boolean;
  /** Currently selected date as an ISO string, or null for none. */
  value: string | null;
  /** Called with the chosen ISO date; the sheet closes itself on pick. */
  onPick: (iso: string) => void;
  /** Called when the user dismisses without picking. */
  onClose: () => void;
}

/**
 * Internal date picker (REQ-004): a slide-from-bottom bottom-sheet modeled on
 * RenameItemModal / CategoryPickerModal — the repo deliberately ships NO
 * native @react-native-community/datetimepicker dependency (#1139), so this is
 * the in-repo S-M date component.
 *
 * Selection is a day/month/year grid ending at today (future dates blocked).
 * Returns an ISO `purchase_date` string (YYYY-MM-DD), the format the RPC
 * accepts for `p_purchase_date` and `validateManualForm` round-trips.
 *
 * The header shows the current year + full month; the grid is a 7-column
 * weekday-aligned row of day cells (weeks starting Monday, es-AR).
 */
export function DatePickerField({
  visible,
  value,
  onPick,
  onClose,
}: DatePickerFieldProps) {
  const today = todayLocalISO();
  // `todayLocalISO()` always produces a calendar-valid ISO date, so the
  // parse of TODAY cannot fail (non-null assertion satisfies the checker).
  const todayParts = partsFromISO(today)!;
  const initial = partsFromISO(value) ?? todayParts;
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month); // 0-based
  const [day, setDay] = useState<number | null>(initial.day);

  // Re-seed the internal buffer whenever the sheet opens (value may change
  // while closed). `today` is a stable string for the whole day, so it is
  // the only extra dependency.
  useEffect(() => {
    if (!visible) return;
    const seed = partsFromISO(value) ?? partsFromISO(today)!;
    setYear(seed.year);
    setMonth(seed.month);
    if (seed.day != null) setDay(seed.day);
  }, [visible, value, today]);

  const grid = monthGrid(year, month, true); // Monday-first weeks
  const selectedISO = isoFromParts({ year, month: month + 1, day });
  const isFuture = selectedISO !== null && isFutureISO(selectedISO, today);

  const selectDay = (d: number) => {
    const iso = isoFromParts({ year, month: month + 1, day: d });
    if (iso === null) return;
    if (isFutureISO(iso, today)) return; // REQ-004: no future dates
    onPick(iso);
  };

  const prevMonth = () => {
    const prev = new Date(year, month - 1, 1);
    setYear(prev.getFullYear());
    setMonth(prev.getMonth());
    setDay(null); // the previous month's days are unknown — clear, force pick
  };
  const nextMonth = () => {
    const next = new Date(year, month + 1, 1);
    if (next.getFullYear() > new Date(today).getFullYear()) return;
    if (
      next.getFullYear() === new Date(today).getFullYear() &&
      next.getMonth() > new Date(today).getMonth()
    )
      return; // never allow navigation past the current month
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setDay(null);
  };

  const canGoNext =
    year < new Date(today).getFullYear() ||
    (year === new Date(today).getFullYear() && month < new Date(today).getMonth());

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      kicker="FECHA DE COMPRA"
      // Header title mirrors the selected date; updates as the user navigates
      // months (the base re-renders it from this prop on every render).
      title={`${pad2(month + 1)} · ${fullMonthES(month)} · ${year}`}
      backdropColor="rgba(0, 0, 0, 0.5)"
      maxHeight="82%"
      divider
    >
      <View style={styles.monthNav}>
        <Pressable
          onPress={prevMonth}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Mes anterior"
          style={styles.navButton}
        >
          <Icon name="chevron.left" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.monthLabel}>
          {fullMonthES(month)}{' '}
          <Text style={styles.yearInline}>{year}</Text>
        </Text>
        <Pressable
          onPress={nextMonth}
          disabled={!canGoNext}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Mes siguiente"
          style={styles.navButton}
        >
          <Icon
            name="chevron.right"
            size={20}
            color={canGoNext ? colors.textPrimary : colors.textSecondary}
          />
        </Pressable>
      </View>
      {/* Own ScrollView instead of the sheet's `scrollable`: the calendar
          grid scrolls while the month nav and the Cancelar/Guardar actions
          stay PINNED under the 82% max-height — the sheet's `scrollable`
          would wrap every child (actions included) and let the buttons
          scroll off on small screens. */}
      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.calendar}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headRow}>
          {weekdayLabels(true).map((label, i) => (
            <View key={i} style={styles.cell}>
              <Text style={styles.weekday}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.grid}>
          {grid.map((d, i) => {
            const iso = d != null ? isoFromParts({ year, month: month + 1, day: d }) : null;
            const isFutureCell = iso !== null && isFutureISO(iso, today);
            const isSelected = d != null && d === day && !isFuture;
            return (
              <View key={i} style={styles.cell}>
                {d != null ? (
                  <Pressable
                    onPress={() => selectDay(d)}
                    disabled={isFutureCell}
                    accessibilityRole="button"
                    accessibilityLabel={`Día ${d}`}
                    style={({ pressed }) => [
                      styles.dayCell,
                      isSelected && styles.dayCellSelected,
                      pressed && !isFutureCell && styles.dayCellPressed,
                      isFutureCell && styles.dayCellDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        isSelected && styles.dayTextSelected,
                        isFutureCell && styles.dayTextDisabled,
                      ]}
                    >
                      {d}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={styles.dayCell} />
                )}
              </View>
            );
          })}
        </View>
        <Text style={styles.helper}>
          {isFuture ? 'No podés elegir una fecha futura' : `Máx. hoy (${today})`}
        </Text>
      </ScrollView>
      <View style={styles.actions}>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [
            styles.actionButton,
            styles.cancelButton,
            pressed && styles.actionPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Cancelar"
        >
          <Text style={styles.cancelLabel}>Cancelar</Text>
        </Pressable>
        <Pressable
          onPress={() => selectedISO !== null && !isFuture && onPick(selectedISO)}
          disabled={selectedISO === null || isFuture}
          style={({ pressed }) => [
            styles.actionButton,
            styles.saveButton,
            pressed && styles.actionPressed,
            (selectedISO === null || isFuture) && styles.actionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Guardar fecha"
          accessibilityState={{ disabled: selectedISO === null || isFuture }}
        >
          <Text style={styles.saveLabel}>Guardar</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  navButton: {
    padding: spacing.sm,
  },
  monthLabel: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  yearInline: {
    color: colors.textSecondary,
  },
  // The scroll container must NOT stretch (`flex: 1` / `flexBasis: 0`):
  // the sheet sizes itself by content (only `maxHeight` is set), so a
  // zero-basis flex child collapses to 0 height and hides the body.
  // `flexShrink: 1` keeps content height but lets the sheet compress on
  // small screens.
  scrollBody: {
    flexShrink: 1,
  },
  calendar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  headRow: {
    flexDirection: 'row',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekday: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  dayCell: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellSelected: {
    backgroundColor: colors.primary,
  },
  dayCellPressed: {
    opacity: 0.85,
  },
  dayCellDisabled: {
    opacity: 0.35,
  },
  dayText: {
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
  dayTextSelected: {
    color: colors.surface,
    fontWeight: '700',
  },
  dayTextDisabled: {
    color: colors.textSecondary,
  },
  helper: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: colors.chipBg,
  },
  saveButton: {
    backgroundColor: colors.primary,
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  cancelLabel: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  saveLabel: {
    ...typography.labelSm,
    color: colors.surface,
    fontWeight: '700',
  },
});