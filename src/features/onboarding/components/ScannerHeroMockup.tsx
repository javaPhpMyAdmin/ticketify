import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/atoms/Icon';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Step-1 hero — the AI scanner mockup. Recreates the reference HTML's
 * ambient green glow + scanner reticle + mock ticket card.
 *
 * The scanner reticle uses the four corner brackets (`primary/20`
 * squares with smaller inner squares). The simulated laser line sits
 * underneath the "IA Sync Detectado" pill — the pill is animated
 * via the CSS-equivalent `animate-pulse` (the Reference design
 * uses a pulsing dot; we render the dot statically because RN's
 * `Animated` isn't needed for a single-tap static screen).
 *
 * The mock ticket card mirrors the reference's stacked layout:
 * store header (icon + name + ref + total), three line items with
 * primary-colored bullets, and the footer with the category/tax
 * chips + verified icon.
 */

export function ScannerHeroMockup() {
  const { t } = useTranslation('onboarding');

  return (
    <View style={styles.wrap}>
      {/* Ambient green glow behind the scanner stage. */}
      <View style={styles.glow} />
      <View style={styles.stage}>
        {/* Scanner reticle — four corner brackets + the "IA Sync
            Detectado" pill at the top, the AUTO-ENFOQUE pill at the
            bottom. We render the brackets as four corners with the
            pill framing the scanner area, matching the reference. */}
        <View style={styles.reticleTop}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={styles.aiPill}>
            <View style={styles.aiDot} />
            <Text style={styles.aiPillText}>{t('step1.aiSyncBadge')}</Text>
          </View>
          <View style={[styles.corner, styles.cornerTR]} />
        </View>
        <View style={styles.laserLine} />
        <View style={styles.reticleBottom}>
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={styles.autoFocusPill}>
            <Icon name="auto_awesome" size={14} color={colors.primary} />
            <Text style={styles.autoFocusText}>{t('step1.autoFocus')}</Text>
          </View>
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        {/* Mock receipt — the actual visual element users see. */}
        <View style={styles.ticket}>
          <View style={styles.ticketHeader}>
            <View style={styles.ticketHeaderLeft}>
              <View style={styles.cartIcon}>
                <Icon name="shopping_cart" size={18} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.storeName}>{t('step1.storeName')}</Text>
                <Text style={styles.storeRef}>{t('step1.storeRef')}</Text>
              </View>
            </View>
            <Text style={styles.ticketTotal}>{t('step1.total')}</Text>
          </View>
          <View style={styles.itemList}>
            <ReceiptItem label={t('step1.item1')} value={t('step1.item1Price')} />
            <ReceiptItem label={t('step1.item2')} value={t('step1.item2Price')} />
            <ReceiptItem label={t('step1.item3')} value={t('step1.item3Price')} />
          </View>
          <View style={styles.ticketFooter}>
            <View style={styles.chipsRow}>
              <View style={styles.chipSecondary}>
                <Text style={styles.chipSecondaryText}>{t('step1.chipCategory')}</Text>
              </View>
              <View style={styles.chipPrimary}>
                <Text style={styles.chipPrimaryText}>{t('step1.chipTax')}</Text>
              </View>
            </View>
            <Icon name="verified" size={20} color={colors.primary} />
          </View>
        </View>
        {/* Receipt-fold detail (two small bars). */}
        <View style={styles.foldRow}>
          <View style={[styles.foldBar, { width: 48 }]} />
          <View style={[styles.foldBar, { width: 16 }]} />
        </View>
      </View>
    </View>
  );
}

function ReceiptItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemLabelWrap}>
        <View style={styles.itemDot} />
        <Text style={styles.itemLabel}>{label}</Text>
      </View>
      <Text style={styles.itemValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    alignItems: 'stretch',
  },
  glow: {
    position: 'absolute',
    top: -spacing.lg,
    left: '12.5%',
    width: '75%',
    height: 224,
    borderRadius: radii.full,
    backgroundColor: 'rgba(16, 185, 129, 0.4)',
    opacity: 0.6,
  },
  stage: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    minHeight: 300,
    gap: spacing.md,
  },
  reticleTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reticleBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  corner: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerTL: {
    transform: [{ rotate: '0deg' }],
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  cornerTR: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  cornerBL: {
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
  },
  cornerBR: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
  },
  aiDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  aiPillText: {
    ...typography.labelCaps,
    color: colors.primary,
    fontSize: 11,
  },
  laserLine: {
    width: '100%',
    height: 2,
    borderRadius: radii.full,
    backgroundColor: 'rgba(16, 185, 129, 0.6)',
  },
  autoFocusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.chipBg,
  },
  autoFocusText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  ticket: {
    backgroundColor: colors.background,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ticketHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cartIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeName: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  storeRef: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 11,
  },
  ticketTotal: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    fontSize: 14,
  },
  itemList: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  itemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  itemLabel: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 12,
  },
  itemValue: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 12,
  },
  ticketFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chipSecondary: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: '#D9DFF5',
  },
  chipSecondaryText: {
    ...typography.labelCaps,
    color: '#5C6274',
    fontSize: 10,
  },
  chipPrimary: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(110, 255, 190, 0.4)',
  },
  chipPrimaryText: {
    ...typography.labelCaps,
    color: '#005236',
    fontSize: 10,
    fontWeight: '700',
  },
  foldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    opacity: 0.6,
  },
  foldBar: {
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.outline,
  },
});
