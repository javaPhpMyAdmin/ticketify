import { Modal, ScrollView, StyleSheet } from 'react-native';

import { Icon, Pressable, Text, View } from '@/components';
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
 * Renders inside react-native's `Modal` so it is a true overlay: it never
 * shares layout with the review screen (a plain `flex: 1` sibling would
 * push the receipt total and confirm button off the footer). The backdrop
 * is a separate absolute-fill Pressable so tapping the sheet's own area
 * never closes it.
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar categorías"
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '70%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: spacing.md,
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
