/**
 * Household summary card for the home feed. Shows the household name,
 * total spend for the current month, and member count. Tapping navigates
 * to the household settings screen.
 *
 * Only rendered when the user has a household (household_sharing is on
 * and household_id is set on the profile).
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Icon, Pressable, Text, View } from '@/components';
import { useSessionUser } from '@/features/auth';
import { formatCurrency, formatCurrencyAmount } from '@/lib/format';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing } from '@/theme';
import type { CurrencyTotal } from '@/types';
import { splitHouseholdTotals } from '../household-currency-split';

interface HouseholdCardProps {
  /**
   * Household spend for the current month, one figure PER UNIT (decision 9).
   * The viewer unit is the headline figure; any other unit renders as a
   * secondary note. Amounts are never summed across units (R1).
   */
  householdTotals: CurrencyTotal[];
  /**
   * Viewer-currency month-over-month delta vs the previous month (%). The
   * badge renders ONLY when this is non-null (no previous figure → no badge);
   * it is never a cross-currency sum (one row per unit).
   */
  changePct?: number | null;
  /** True while the household total query is loading. */
  isLoading: boolean;
}

const AVATAR_SIZE = 45;
const AVATAR_OVERLAP = AVATAR_SIZE / 3.6;
const MAX_DISPLAY_MEMBERS = 4;

/** Position/stacking per visible avatar (0 = left/front of the eclipse). */
const avatarLayout = (idx: number) =>
  ({
    zIndex: MAX_DISPLAY_MEMBERS + 1 - idx,
    marginLeft: idx > 0 ? -AVATAR_OVERLAP : 0,
  } as const);

/**
 * Horizontal avatar stack for the household card (GitHub-contributors
 * style): the signed-in user leads on the left, the rest overlap in
 * eclipse. Rendered above the "Gasto del hogar" label inside the card.
 */
function HouseholdAvatarStack({
  members,
  currentUserId,
}: {
  members: { full_name?: string; avatar_url?: string; user_id: string }[];
  currentUserId?: string;
}) {
  // The RPC returns every household member, signed-in user included.
  const ordered = useMemo(() => {
    const me = members.find((m) => m.user_id === currentUserId);
    const others = members.filter((m) => m.user_id !== currentUserId);
    return me ? [me, ...others] : members;
  }, [members, currentUserId]);
  if (ordered.length === 0) return null;

  const shown = ordered.slice(0, MAX_DISPLAY_MEMBERS);
  const overflow = ordered.length - MAX_DISPLAY_MEMBERS;

  return (
    <View style={styles.avatarStack}>
      {shown.map((member, idx) => (
        <View
          key={member.user_id}
          style={[styles.avatarWrap, avatarLayout(idx)]}
        >
          <AvatarCircle member={member} />
        </View>
      ))}
      {overflow > 0 ? (
        <View
          style={[
            styles.avatarWrap,
            { marginLeft: -AVATAR_OVERLAP, zIndex: 0 },
          ]}
        >
          <View style={[styles.avatar, styles.overflowBadge]}>
            <Text style={styles.overflowText}>+{overflow}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Single circular avatar. The borderRadius lives on the Image itself (like
 * the Home header): clipping inside an `overflow: hidden` parent does NOT
 * round the photo on Android, which is why the earlier version painted a
 * plain rectangle.
 *
 * avatar_url is trusted only when it is a real http(s) URL. Stored avatar
 * object paths (private storage, see receipt-photo.ts) cannot be served by
 * `getPublicUrl`, so an Image pointed at a raw path renders an empty white
 * rectangle on Android — we route those (and dead links caught by onError)
 * to the initials fallback instead.
 */
function AvatarCircle({
  member,
}: {
  member: { full_name?: string; avatar_url?: string; user_id: string };
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = (member.full_name ?? 'U')
    .split(' ')
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const isHttpUrl = (member.avatar_url ?? '').startsWith('http');

  if (member.avatar_url && isHttpUrl && !imageFailed) {
    return (
      <Image
        source={{ uri: member.avatar_url }}
        style={styles.avatar}
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{initials}</Text>
    </View>
  );
}

export function HouseholdCard({
  householdTotals,
  changePct,
  isLoading,
}: HouseholdCardProps) {
  const { t } = useTranslation(['household', 'analytics']);
  const household = useHouseholdStore((s) => s.household);
  const members = useHouseholdStore((s) => s.members);
  const currency = useSettingsStore((s) => s.currency);
  const sharingEnabled = useSettingsStore((s) => s.household_sharing);
  const { userId } = useSessionUser();

  // Don't render if sharing is off or no household exists.
  if (!sharingEnabled || !household) return null;

  const memberCount = members.length;
  const memberLabel = memberCount === 0
    ? ''
    : t('household:householdMemberCount', { count: memberCount });
  // Same badge semantics as RunRateCard: spending ABOVE the previous month is
  // a warning tint, spending below is the brand container; the delta always
  // renders signed. The badge is present only when there is a figure to
  // compare (changePct non-null).
  const up = changePct != null && changePct > 0;
  const deltaPrefix = changePct != null && changePct > 0 ? '+' : '';
  // Viewer unit = headline figure; other units = secondary note. Never a
  // cross-currency sum (money-integrity spec).
  const { viewerTotal, foreignTotals } = splitHouseholdTotals(
    householdTotals,
    currency,
  );

  return (
    <Pressable
      onPress={() => router.push('/settings/household')}
      accessibilityRole="button"
      accessibilityLabel={t('household:householdCardA11y', { name: household.name })}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card style={styles.card}>
        {/* Tinted brand background: raw `primaryContainer` (#6FFFBE light /
            #00422B dark) is too saturated for a whole card, so it renders
            as a translucent layer over the card's `surface`. Opacity on a
            dedicated background View (not on a parent) keeps the content
            fully opaque and the borderLeft accent readable in both themes. */}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, styles.tint]}
        />
        {changePct != null ? (
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.badge,
                { backgroundColor: up ? '#fbe3e3' : colors.primaryContainer },
              ]}
            >
              <Icon
                name={up ? 'arrow.up.right' : 'arrow.down.right'}
                size={14}
                color={up ? 'red' : colors.primaryDark}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: up ? 'red' : colors.primaryDark },
                ]}
              >
                {deltaPrefix}
                {changePct}%{' '}
                {t('analytics:runRateBadge', {
                  source: t('analytics:runRateSourceMom'),
                })}
              </Text>
            </View>
          </View>
        ) : null}
        {memberCount > 1 ? (
          <View style={styles.membersRow}>
            <HouseholdAvatarStack
              members={members}
              currentUserId={userId ?? undefined}
            />
            {memberLabel ? (
              <Text style={styles.members}>{memberLabel}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.iconCircle}>
            <Icon name="house.fill" size={22} color={colors.primaryDark} />
          </View>
        )}
        <View style={styles.bottomRow}>
          <View style={styles.info}>
            <Text style={styles.label}>{t('household:householdSpendingLabel')}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {household.name}
            </Text>
          </View>
          <View style={styles.amountContainer}>
            {isLoading ? (
              <Text style={styles.amount}>…</Text>
            ) : (
              <Text style={styles.amount}>
                {formatCurrency(viewerTotal, currency)}
              </Text>
            )}
          </View>
        </View>
        {!isLoading && foreignTotals.length > 0 ? (
          <Text style={styles.otherUnits} numberOfLines={2}>
            {t('household:otherUnitsNote', {
              amounts: foreignTotals
                .map(
                  (group) =>
                    `${group.currency} ${formatCurrencyAmount(group.total, group.currency)}`,
                )
                .join(' · '),
            })}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Accent border mirrors the sibling BudgetCard on Home so the household
  // card reads as part of the same brand family, not a flat orphan row.
  // Column flow (badge → members → label/name + amount) keeps a long trend
  // badge from overlapping the avatar stack: every block reserves its own
  // space instead of floating over the card.
  card: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  // Translucent brand tint over the card's surface background. The layer
  // is clipped to the card's own radius so the rounded corners stay clean.
  tint: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.lg,
    overflow: 'hidden',
    opacity: 0.3,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
  },
  // Avatars + member-count label share their own row under the trend badge.
  membersRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: spacing.md,
    backgroundColor: 'transparent',
  },
  // "Gasto del hogar" label + household name on the left, amount on the
  // right. The info column keeps `flex: 1` so a long name ellipsizes instead
  // of pushing the amount off the card.
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'transparent',
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    // Positioning only — the circular clip lives on the avatar itself
    // (borderRadius on Image/fallback). No backgroundColor here, so a
    // gap never paints a white square over the card's tint.
    backgroundColor: 'transparent',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    // Radius lives ON the Image (same pattern as the Home header). Parent
    // overflow:hidden does not round an Image on Android.
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.background,
  },
  overflowBadge: {
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  info: {
    flex: 1,
    gap: 6,
    backgroundColor: 'transparent',
  },
  label: {
    fontWeight: '800',
    fontSize: 16,
    color: colors.textSecondary,
  },
  name: {
    fontSize: 20,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  amountContainer: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
  },
  amount: {
    fontSize: 23,
    fontWeight: '900',
    color: colors.primary,
  },
  // Secondary line: the household's other recorded units, shown as recorded
  // (never converted or summed into the headline).
  otherUnits: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  // First row of the card: a content-sized pill. `flexShrink: 1` + a
  // shrinkable label let an extreme delta wrap inside the card instead of
  // overflowing it.
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    maxWidth: '100%',
    flexShrink: 1,
  },
  badgeText: {
    fontWeight: '900',
    fontSize: 14,
    fontStyle: 'normal',
    color: 'red',
    flexShrink: 1,
  },
  members: {
    // ...typography.labelSm,
    fontSize: 16,
    // lineHeight: 16,
    fontWeight: '900',
    color: colors.textSecondary,
  },
});
