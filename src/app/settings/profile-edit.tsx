import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Pressable, Spinner, Text, View } from '@/components';
import { useProfile } from '@/features/profile';
import { useDialogStore } from '@/stores/use-dialog-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Full-screen profile editor reached from the profile screen's
 * "Editar perfil" row (`/settings/profile-edit`).
 *
 * Lets the user update their display name (profiles.full_name) and
 * see their current avatar. No photo picker — avatar display only.
 * Available to ALL users regardless of subscription tier.
 */
export default function ProfileEditScreen() {
  const { user, setFullName } = useProfile();

  const [draft, setDraft] = useState<string>(user?.full_name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Keep draft in sync with server value until the user touches it.
  useEffect(() => {
    if (dirty || saving) return;
    if (user) setDraft(user.full_name ?? '');
  }, [user, dirty, saving]);

  const trimmed = draft.trim();
  const valid = trimmed.length > 0 && trimmed !== (user?.full_name ?? '');
  const avatarUrl = user?.avatar_url;
  const displayName = user?.full_name ?? 'U';
  const initials = displayName
    .split(' ')
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const handleSave = async () => {
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    const result = await setFullName(trimmed);
    if (result.status === 'ok') {
      useDialogStore.getState().show({
        title: 'Listo',
        message: 'Tu nombre fue actualizado.',
        primaryLabel: 'OK',
        onPrimary: () => router.back(),
      });
    } else {
      setSaving(false);
      setError(result.message);
    }
  };

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
        <Text style={styles.title}>Editar perfil</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar */}
          <View style={styles.avatarWrap}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{initials}</Text>
              </View>
            )}
          </View>

          {/* Name input */}
          <View style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Nombre completo</Text>
            <TextInput
              value={draft}
              onChangeText={(v) => {
                setDirty(true);
                setDraft(v);
              }}
              placeholder="Tu nombre"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="name"
              editable={!saving}
              style={styles.input}
              accessibilityLabel="Nombre completo"
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={handleSave}
            disabled={!valid || saving}
            accessibilityRole="button"
            accessibilityLabel="Guardar nombre"
            style={({ pressed }) => [
              styles.saveButton,
              (!valid || saving) && styles.saveButtonDisabled,
              pressed && styles.saveButtonPressed,
            ]}
          >
            {saving ? (
              <Spinner size="sm" color={colors.onPrimary} />
            ) : (
              <Text style={styles.saveButtonText}>Guardar</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
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
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
    alignItems: 'center',
  },
  avatarWrap: {
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarFallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    ...typography.headlineLgMobile,
    color: colors.background,
    fontWeight: '700',
  },
  fieldCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  input: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    paddingVertical: spacing.xs,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
    width: '100%',
  },
  saveButton: {
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonPressed: {
    opacity: 0.85,
  },
  saveButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
});
