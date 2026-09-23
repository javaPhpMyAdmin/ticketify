import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Icon } from '@/components/atoms/Icon';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Step-3 hero — the weekly insights card. Mirrors the reference HTML's
 * analytics mockup: a header with the query_stats icon + total, a
 * -14% trending_down pill, a 7-bar weekly chart (with Saturday
 * highlighted as $120 in primary), a milestone "Gastaste $108 menos"
 * badge with the celebration emoji-flanked primary icon, and a
 * RENDIMIENTO +28% sparkline + label.
 *
 * The chart bars are pure View rectangles; their heights are
 * pre-sized so Saturday's bar is visibly the tallest with the primary
 * color, matching the HTML's `h-20 + bg-primary` shape.
 */

export function InsightsHeroMockup() {
  const { t } = useTranslation('onboarding');
  const dayLabels = t('step3.dayLabels', { returnObjects: true }) as string[];
  const safeDays: string[] = Array.isArray(dayLabels) && dayLabels.length === 7
    ? (dayLabels as string[])
    : ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  // Bar heights in percent of the chart's plot area (100 max). Each
  // value lands in a different height bucket so all 7 bars are
  // visually distinguishable — Saturday (idx 5) is the peak per the
  // reference HTML.
  const barHeights = [32, 48, 24, 56, 64, 80, 28];

  return (
    <View style={styles.wrap}>
      <View style={styles.glow} />
      <View style={styles.card}>
        {/* Header row: query_stats icon + label/total + -14% pill. */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconBox}>
              <Icon name="query_stats" size={18} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.weekHeader}>{t('step3.weekHeader')}</Text>
              <Text style={styles.weekTotal}>{t('step3.weekTotal')}</Text>
            </View>
          </View>
          <View style={styles.deltaPill}>
            <Icon name="trending_down" size={14} color={colors.primary} />
            <Text style={styles.deltaText}>{t('step3.weekDelta')}</Text>
          </View>
        </View>
        {/* Weekly bar chart card. */}
        <View style={styles.chartCard}>
          <View style={styles.chartArea}>
            {safeDays.map((label, idx) => {
              const isPeak = idx === 5;
              return (
                <View key={idx} style={styles.chartColumn}>
                  {isPeak ? (
                    <View style={styles.peakLabel}>
                      <Text style={styles.peakLabelText}>
                        {t('step3.dayHigh')}
                      </Text>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.chartBar,
                      {
                        height: `${barHeights[idx]}%`,
                        backgroundColor: isPeak
                          ? colors.primary
                          : colors.surfaceDim,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.chartLabel,
                      isPeak && styles.chartLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
        {/* Milestone badge. */}
        <View style={styles.milestone}>
          <View style={styles.milestoneIcon}>
            <Icon name="celebration" size={16} color={colors.onPrimary} />
          </View>
          <Text style={styles.milestoneText}>
            {t('step3.milestone')}
          </Text>
        </View>
        {/* Performance sparkline row. */}
        <View style={styles.perfRow}>
          <View style={styles.perfLeft}>
            <View style={styles.perfIcon}>
              <Icon name="trending_up" size={16} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.perfLabel}>{t('step3.perfLabel')}</Text>
              <Text style={styles.perfValue}>{t('step3.perfValue')}</Text>
            </View>
          </View>
          <View style={styles.spark}>
            <Svg width={64} height={28} viewBox="0 0 64 28">
              <Path
                d="M2 24 C 14 22, 18 16, 28 17 C 38 18, 42 6, 62 4"
                stroke={colors.primary}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <Circle cx={62} cy={4} r={3} fill={colors.primary} />
            </Svg>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    width: '100%',
  },
  glow: {
    position: 'absolute',
    inset: -4,
    borderRadius: radii.lg,
    backgroundColor: 'rgba(110, 255, 190, 0.18)',
    opacity: 0.75,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIconBox: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekHeader: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  weekTotal: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    fontSize: 18,
  },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: 'rgba(110, 255, 190, 0.50)',
  },
  deltaText: {
    ...typography.labelSm,
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  chartCard: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 96,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  peakLabel: {
    position: 'absolute',
    top: -16,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  peakLabelText: {
    ...typography.labelCaps,
    color: colors.onPrimary,
    fontSize: 10,
    fontWeight: '700',
  },
  chartBar: {
    width: '60%',
    maxWidth: 18,
    borderTopLeftRadius: radii.sm,
    borderTopRightRadius: radii.sm,
  },
  chartLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  chartLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  milestone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.md,
  },
  milestoneIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneText: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontSize: 12,
    flex: 1,
    fontWeight: '500',
  },
  perfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
    backgroundColor: colors.chipBg,
    borderRadius: radii.md,
  },
  perfLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  perfIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perfLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  perfValue: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  spark: {
    width: 64,
    height: 28,
  },
});
