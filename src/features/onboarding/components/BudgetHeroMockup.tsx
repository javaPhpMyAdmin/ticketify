import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/atoms/Icon';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Step-2 hero — the monthly budget card. Mirrors the reference HTML's
 * monochrome-categories block:
 *
 *   ┌─────────────────────────────────────────┐
 *   │ ● LÍMITE MENSUAL ACTIVO       [Octubre]│
 *   │ $760.00 / $1,200.00                     │
 *   │ ✓ Restante seguro para gastar           │
 *   │ [■■■■■■■■···············] multi-segment │
 *   │ 63% UTILIZADO            12 DÍAS RESTAN.│
 *   │ 🏠$456  🍕$288  🛒$216  🎟️$120          │
 *   ├─────────────────────────────────────────┤
 *   │ ✨ AUTO-CATEGORIZACIÓN          ✓       │
 *   │   Ticket escaneado → 🛒 Compras         │
 *   └─────────────────────────────────────────┘
 *
 * The multi-segment progress bar is rendered with four colored fills
 * (blue 38% / rose 24% / emerald 18% / amber 10%) to mirror the
 * reference's blue/tertiary/primary/amber palette. The 4 category
 * chips at the bottom are the same emoji + amount + label trio from
 * the HTML. The AUTO-CATEGORIZACIÓN row at the footer uses the
 * emerald-fixed circle + primary verified icon.
 */

export function BudgetHeroMockup() {
  const { t } = useTranslation('onboarding');

  return (
    <View style={styles.wrap}>
      <View style={styles.glowA} />
      <View style={styles.glowB} />
      <View style={styles.card}>
        {/* Header pill row. */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.headerDot} />
            <Text style={styles.limitActiveLabel}>
              {t('step2.limitActive')}
            </Text>
          </View>
          <View style={styles.monthPill}>
            <Text style={styles.monthPillText}>{t('step2.monthPill')}</Text>
          </View>
        </View>
        {/* Total row. */}
        <View style={styles.totalBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.usedValue}>{t('step2.used')}</Text>
            <Text style={styles.totalValue}> / {t('step2.total')}</Text>
          </View>
          <View style={styles.safeRow}>
            <Icon name="check_circle" size={16} color={colors.primary} />
            <Text style={styles.safeText}>{t('step2.safeToSpend')}</Text>
          </View>
        </View>
        {/* Multi-segment progress bar (38/24/18/10, rounded). */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressSeg, styles.segBlue, { width: '38%' }]} />
          <View style={[styles.progressSeg, styles.segRose, { width: '24%' }]} />
          <View style={[styles.progressSeg, styles.segEmerald, { width: '18%' }]} />
          <View style={[styles.progressSeg, styles.segAmber, { width: '10%' }]} />
        </View>
        <View style={styles.progressMeta}>
          <Text style={styles.progressMetaText}>{t('step2.usedLabel')}</Text>
          <Text style={styles.progressMetaText}>{t('step2.daysLeft')}</Text>
        </View>
        {/* Category chips (4). */}
        <View style={styles.chipsRow}>
          <CategoryChip
            emoji="🏠"
            bg="#EFF6FF"
            fg="#1E3A8A"
            subFg="#1E40AF"
            amount={t('step2.catHomeAmount')}
            label={t('step2.catHomeLabel')}
          />
          <CategoryChip
            emoji="🍕"
            bg="#FFF1F2"
            fg="#9F1239"
            subFg="#BE123C"
            amount={t('step2.catFoodAmount')}
            label={t('step2.catFoodLabel')}
          />
          <CategoryChip
            emoji="🛒"
            bg="#ECFDF5"
            fg="#065F46"
            subFg="#047857"
            amount={t('step2.catSuperAmount')}
            label={t('step2.catSuperLabel')}
          />
          <CategoryChip
            emoji="🎟️"
            bg="#FFFBEB"
            fg="#92400E"
            subFg="#B45309"
            amount={t('step2.catLeisureAmount')}
            label={t('step2.catLeisureLabel')}
          />
        </View>
        {/* Auto-categorization row. */}
        <View style={styles.autoRow}>
          <View style={styles.autoLeft}>
            <View style={styles.autoIconBox}>
              <Icon name="magic_button" size={16} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.autoTitle}>{t('step2.autoCatTitle')}</Text>
              <Text style={styles.autoSubtitle}>
                {t('step2.autoCatSubtitle')}
              </Text>
            </View>
          </View>
          <Icon name="verified" size={18} color={colors.primary} />
        </View>
      </View>
    </View>
  );
}

function CategoryChip({
  emoji,
  bg,
  fg,
  subFg,
  amount,
  label,
}: {
  emoji: string;
  bg: string;
  fg: string;
  subFg: string;
  amount: string;
  label: string;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={styles.chipEmoji}>{emoji}</Text>
      <Text style={[styles.chipAmount, { color: fg }]}>{amount}</Text>
      <Text style={[styles.chipLabel, { color: subFg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    width: '100%',
  },
  glowA: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  glowB: {
    position: 'absolute',
    left: -32,
    bottom: -32,
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: 'rgba(217, 223, 245, 0.30)',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  limitActiveLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  monthPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: 'rgba(110, 255, 190, 0.5)',
  },
  monthPillText: {
    ...typography.labelCaps,
    color: '#005236',
    fontSize: 11,
  },
  totalBlock: {
    gap: 2,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  usedValue: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  totalValue: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  safeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  safeText: {
    ...typography.labelSm,
    color: colors.primary,
    fontSize: 12,
  },
  progressTrack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radii.full,
    backgroundColor: colors.divider,
    overflow: 'hidden',
    gap: 2,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  progressSeg: {
    height: '100%',
    borderRadius: radii.full,
  },
  segBlue: {
    backgroundColor: '#3B82F6',
  },
  segRose: {
    backgroundColor: '#FB7185',
  },
  segEmerald: {
    backgroundColor: colors.primary,
  },
  segAmber: {
    backgroundColor: '#FBBF24',
  },
  progressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressMetaText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
  },
  chipEmoji: {
    fontSize: 13,
  },
  chipAmount: {
    ...typography.labelSm,
    fontWeight: '700',
    fontSize: 12,
  },
  chipLabel: {
    ...typography.labelSm,
    fontSize: 11,
    fontWeight: '400',
  },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  autoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  autoIconBox: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(110, 255, 190, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoTitle: {
    ...typography.labelCaps,
    color: colors.textPrimary,
    fontSize: 11,
  },
  autoSubtitle: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 11,
  },
});
