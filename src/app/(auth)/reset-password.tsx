import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FieldGroup, Pressable, Spinner, Text, View } from '@/components';
import { supabase } from '@/lib/supabase';
import { colors, radii, spacing, typography } from '@/theme';

type ExchangeState = 'exchanging' | 'ready' | 'invalid';

/**
 * Deep-link target for password-recovery emails (user-auth spec).
 *
 * The email carries a PKCE auth code in the URL (?code=...). On mount the
 * code is exchanged for a session (auth-js resolves the /recovery
 * verifier automatically, ADR-3), then the user picks a new password via
 * updateUser. Links without a valid code show an invalid-link state.
 */
export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;

  const [exchangeState, setExchangeState] = useState<ExchangeState>(
    code ? 'exchanging' : 'invalid',
  );
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code || exchangeState !== 'exchanging') return;
    let cancelled = false;
    supabase.auth
      .exchangeCodeForSession(code)
      .then(() => {
        if (!cancelled) setExchangeState('ready');
      })
      .catch(() => {
        if (!cancelled) setExchangeState('invalid');
      });
    return () => {
      cancelled = true;
    };
    // Run once per code; the exchange decides the next state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const canSubmit = password.length >= 8 && !pending;

  const handleReset = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        return;
      }
      // Fresh session from the recovery exchange is active; the root gate
      // exposes the app content.
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your password.');
    } finally {
      setPending(false);
    }
  };

  if (exchangeState !== 'ready') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.statusWrap}>
          {exchangeState === 'exchanging' ? (
            <>
              <Spinner size="md" />
              <Text style={styles.subtitle}>Checking your reset link…</Text>
            </>
          ) : (
            <>
              <Text style={styles.kicker}>TICKETIFY</Text>
              <Text style={styles.title}>Invalid link</Text>
              <Text style={styles.subtitle}>
                This password-reset link is invalid or has expired. Request a
                new one and try again.
              </Text>
              <Pressable
                style={styles.primaryButton}
                onPress={() => router.replace('/forgot-password')}
                accessibilityRole="button"
                accessibilityLabel="Request a new reset link"
              >
                <Text style={styles.primaryButtonText}>New Reset Link</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heading}>
            <Text style={styles.kicker}>TICKETIFY</Text>
            <Text style={styles.title}>Choose a new password</Text>
            <Text style={styles.subtitle}>
              At least 8 characters. You will be signed in after the update.
            </Text>
          </View>

          <View style={styles.form}>
            <FieldGroup label="New password" helper="At least 8 characters.">
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                placeholder="Choose a new password"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!pending}
                onSubmitEditing={handleReset}
                returnKeyType="go"
              />
            </FieldGroup>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={styles.primaryButton}
              onPress={handleReset}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Update password"
            >
              {pending ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Update Password</Text>
              )}
            </Pressable>
          </View>
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
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl * 2,
    paddingBottom: spacing.xxl,
  },
  statusWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  heading: {
    gap: spacing.xs,
    marginBottom: spacing.xxl,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.primary,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  form: {
    gap: spacing.md,
  },
  input: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
    alignSelf: 'stretch',
  },
  primaryButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
  },
});
