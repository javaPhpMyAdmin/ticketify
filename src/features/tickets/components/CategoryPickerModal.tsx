import { ScrollView, StyleSheet } from 'react-native';

import { BottomSheet, Icon, Pressable, Text, View } from '@/components';
import { EXPENSE_CATEGORIES } from '@/features/home/categories';
import { colors, radii, spacing, typography } from '@/theme';

export interface CategoryPickerModalProps {
  /** Whether the sheet is open. Kept mounted so closing animates. */
  visible: boolean;
  /** Name of the item being categorized (shown in the title). */
  itemName: string;
  /** Currently selected category key, if any. */
  selectedKey: string | null;
  /** Called with the chosen category key (or 'otros'). */
  onSelect: (categoryKey: string) => void;
  /** Called when the user dismisses the picker. */
  onClose: () => void;
}

/**
 * Category picker for a receipt line item on the review screen: a modal
 * bottom sheet listing every category in the expense taxonomy with its
 * icon. The user's tap both confirms the category and closes the sheet —
 * the AI suggestion stays untouched in `ai_suggested_category_id`, the
 * user's choice is written to `category_id`, and the save path prefers
 * the user's choice.
 *
 * Renders inside the shared `BottomSheet` shell (transparent slide-up
 * `Modal`) so it is a true overlay: it never shares layout with the review
 * screen (a plain `flex: 1` sibling would push the receipt total and
 * confirm button off the footer). The backdrop is a separate absolute-fill
 * Pressable so tapping the sheet's own area never closes it.
 *
 * Chrome parity notes (kept from the pre-BottomSheet version):
 *   - `surface` fill, `radius="xl"` corners, `maxHeight="70%"`, darker
 *     backdrop — all custom props on the shared shell.
 *   - `handleStyle` restores the old 36/`colors.divider` handle (the shell's
 *     default is 40/`colors.border`), `sheetPaddingTop` restores the old
 *     `spacing.md` top gap (the shell's default is `spacing.sm`), and
 *     `includeBottomInset={false}` keeps the sheet flush with the screen
 *     bottom (the old sheet had NO bottom SafeArea; its `spacing.xl` bottom
 *     padding covered the home-indicator area).
 *   - NO close button and NO header row (`showCloseButton={false}` without
 *     `kicker`/`title`): this sheet dismisses only on backdrop tap or
 *     category selection, exactly like before.
 *   - The title + item name + grid live in the BODY (the old sheet applied
 *     `paddingHorizontal` at the sheet level); the grid keeps its own
 *     ScrollView so only the category grid scrolls, never the heading.
 */
export function CategoryPickerModal({
  visible,
  itemName,
  selectedKey,
  onSelect,
  onClose,
}: CategoryPickerModalProps) {
  const categories = Object.values(EXPENSE_CATEGORIES);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      backdropLabel="Cerrar categorías"
      backdropColor="rgba(0, 0, 0, 0.5)"
      surface
      radius="xl"
      maxHeight="70%"
      showCloseButton={false}
      handleStyle={styles.handle}
      sheetPaddingTop={spacing.md}
      includeBottomInset={false}
    >
      <View style={styles.body}>
        <Text style={styles.title}>Categoría</Text>
        <Text style={styles.itemName} numberOfLines={1}>
          {itemName}
        </Text>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
          {categories.map((category) => {
            const selected = category.key === selectedKey;
            return (
              <Pressable
                key={category.key}
                onPress={() => onSelect(category.key)}
                style={({ pressed }) => [
                  styles.cell,
                  selected && styles.cellSelected,
                  pressed && styles.cellPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={category.label}
              >
                <Icon
                  name={category.icon}
                  size={20}
                  color={selected ? colors.primary : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.cellLabel,
                    selected && styles.cellLabelSelected,
                  ]}
                  numberOfLines={1}
                >
                  {category.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // Pre-BottomSheet handle parity: the shell defaults to 40/`colors.border`;
  // this picker's handle has always been 36/`colors.divider`.
  handle: {
    width: 36,
    backgroundColor: colors.divider,
  },
  // Body carries the sheet-level padding the old version applied to the
  // whole sheet: horizontal inset + bottom padding under the grid.
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  itemName: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  scroll: {
    flexGrow: 0,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.chipBg,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cellSelected: {
    backgroundColor: colors.primaryContainer,
    borderColor: colors.primary,
  },
  cellPressed: {
    transform: [{ scale: 0.97 }],
  },
  cellLabel: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  cellLabelSelected: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
});
