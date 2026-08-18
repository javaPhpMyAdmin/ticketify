/**
 * Household settings screen — full-screen view reached from the profile
 * screen's "Uso compartido del hogar" row. Shows the household name,
 * member list with roles, invite/join actions, and leave/dissolve
 * controls gated by role.
 *
 * When the user has no household, the screen shows an empty state with
 * "Crear hogar" (generates a new household) or "Unirse con código"
 * (opens the join modal).
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, EmptyState, Icon, Pressable, Spinner, Text, View } from '@/components';
import { useSessionUser } from '@/features/auth';
import { useHousehold } from '@/features/household';
import { CreateHouseholdModal } from '@/features/household/components/CreateHouseholdModal';
import { JoinHouseholdModal } from '@/features/household/components/JoinHouseholdModal';
import {
  disbandHousehold,
  leaveHousehold,
  READ_ERROR_MESSAGE,
} from '@/lib/supabase/feature-access';
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';
import type { HouseholdRole } from '@/types';

const MAX_MEMBERS = 5;

export default function HouseholdScreen() {
  const { userId } = useSessionUser();
  const { household, members, role, isLoading } = useHousehold();
  const setHouseholdSharing = useSettingsStore((s) => s.setHouseholdSharing);

  const [leaving, setLeaving] = useState(false);
  const [disbanding, setDisbanding] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);

  const isOwner = role === 'owner';

  // ── Leave household ────────────────────────────────────────────────────
  const handleLeave = () => {
    Alert.alert(
      'Salir del hogar',
      '¿Seguro que querés salir? Si sos el único miembro, el hogar se disuelve.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            const result = await leaveHousehold();
            if (result.status === 'ok') {
              useHouseholdStore.getState().reset();
              setHouseholdSharing(false);
              if (userId) {
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.household(userId),
                });
              }
            } else {
              Alert.alert('Error', READ_ERROR_MESSAGE);
            }
            setLeaving(false);
          },
        },
      ],
    );
  };

  // ── Disband household (owner only) ─────────────────────────────────────
  const handleDisband = () => {
    if (!household) return;
    Alert.alert(
      'Disolver hogar',
      'Se eliminará el hogar para todos los miembros. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Disolver',
          style: 'destructive',
          onPress: async () => {
            setDisbanding(true);
            const result = await disbandHousehold(household.id);
            if (result.status === 'ok') {
              useHouseholdStore.getState().reset();
              setHouseholdSharing(false);
              if (userId) {
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.household(userId),
                });
              }
            } else {
              Alert.alert('Error', READ_ERROR_MESSAGE);
            }
            setDisbanding(false);
          },
        },
      ],
    );
  };

  // ── Create household (via modal) ──────────────────────────────────────
  const handleCreate = () => {
    setCreateModalVisible(true);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <Icon name="arrow.left" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Hogar</Text>
        </View>
        <View style={styles.loadingWrap}>
          <Spinner size="sm" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!household) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <Icon name="arrow.left" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Hogar</Text>
        </View>
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="house.fill"
            title="Sin hogar todavía"
            body="Creá un hogar o unite con un código de invitación para ver los gastos de tu familia en conjunto."
          />

          <View style={styles.emptyActions}>
            <Pressable
              onPress={handleCreate}
              style={({ pressed }) => [
                styles.createButton,
                pressed && styles.createButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Crear hogar"
            >
              <Text style={styles.createButtonText}>Crear hogar</Text>
            </Pressable>

            <Pressable
              onPress={() => setJoinModalVisible(true)}
              style={({ pressed }) => [
                styles.joinButton,
                pressed && styles.joinButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Unirse con código"
            >
              <Text style={styles.joinButtonText}>Unirse con código</Text>
            </Pressable>
          </View>
        </View>

        <JoinHouseholdModal
          visible={joinModalVisible}
          onClose={() => setJoinModalVisible(false)}
        />
        <CreateHouseholdModal
          visible={createModalVisible}
          onClose={() => setCreateModalVisible(false)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Icon name="arrow.left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>{household.name}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Members ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            MIEMBROS ({members.length}/{MAX_MEMBERS})
          </Text>
          <Card>
            {members.map((m, index) => {
              const isCurrentUser = m.user_id === userId;
              return (
                <View
                  key={m.user_id}
                  style={[
                    styles.memberRow,
                    index < members.length - 1 && styles.memberRowBorder,
                  ]}
                >
                  <View style={styles.memberLeft}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.full_name ?? 'Miembro'}
                      {isCurrentUser ? ' (vos)' : ''}
                    </Text>
                    {m.role === 'owner' ? (
                      <View style={styles.ownerBadge}>
                        <Text style={styles.ownerBadgeText}>DUEÑO</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.memberDate}>
                    {new Date(m.joined_at).toLocaleDateString('es-AR', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                </View>
              );
            })}
          </Card>
        </View>

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          {isOwner && members.length < MAX_MEMBERS ? (
            <Pressable
              onPress={() => router.push('/settings/invite')}
              style={({ pressed }) => [
                styles.actionRow,
                pressed && styles.actionRowPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Invitar a un miembro"
            >
              <Icon
                name="person.badge.plus"
                size={20}
                color={colors.primary}
              />
              <Text style={styles.actionText}>Invitar</Text>
              <Icon
                name="chevron.right"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}

          <Pressable
            onPress={handleLeave}
            disabled={leaving}
            style={({ pressed }) => [
              styles.leaveRow,
              pressed && styles.leaveRowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Salir del hogar"
          >
            {leaving ? (
              <Spinner size="sm" color={colors.danger} />
            ) : (
              <>
                <Icon name="rectangle.portrait.and.arrow.right" size={20} color={colors.danger} />
                <Text style={styles.leaveText}>Salir del hogar</Text>
              </>
            )}
          </Pressable>

          {isOwner ? (
            <Pressable
              onPress={handleDisband}
              disabled={disbanding}
              style={({ pressed }) => [
                styles.disbandRow,
                pressed && styles.disbandRowPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Disolver hogar"
            >
              {disbanding ? (
                <Spinner size="sm" color={colors.danger} />
              ) : (
                <>
                  <Icon name="trash" size={20} color={colors.danger} />
                  <Text style={styles.disbandText}>Disolver hogar</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // ── Member rows ──────────────────────────────────────────────────────
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  memberRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  memberName: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  ownerBadge: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  ownerBadgeText: {
    ...typography.labelSm,
    color: colors.primaryDark,
    fontWeight: '700',
    fontSize: 10,
  },
  memberDate: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  // ── Empty state ──────────────────────────────────────────────────────
  emptyWrap: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyActions: {
    width: '100%',
    gap: spacing.md,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  createButtonPressed: {
    opacity: 0.85,
  },
  createButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  joinButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  joinButtonPressed: {
    opacity: 0.85,
  },
  joinButtonText: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  // ── Action rows ──────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primaryContainer,
  },
  actionRowPressed: {
    opacity: 0.85,
  },
  actionText: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '600',
    flex: 1,
  },
  leaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  leaveRowPressed: {
    opacity: 0.85,
  },
  leaveText: {
    ...typography.bodyMd,
    color: colors.danger,
    fontWeight: '600',
  },
  disbandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disbandRowPressed: {
    opacity: 0.85,
  },
  disbandText: {
    ...typography.bodyMd,
    color: colors.danger,
    fontWeight: '600',
  },
});
