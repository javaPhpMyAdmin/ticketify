import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FieldGroup, Pressable, Spinner, Text, View } from '@/components';
import { useSessionStore } from '@/features/auth';
import { signInWithProvider, type OAuthProvider } from '@/lib/auth/oauth';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Email/password and OAuth sign-in (user-auth spec).
 *
 * Submit is disabled while a request is in flight; invalid credentials
 * surface the Supabase error message and keep the user on this screen.
 * OAuth runs the PKCE flow (ADR-3); a cancelled or failed flow leaves the
 * user here without a session.
 */
export default function SignInScreen() {
  const signInWithEmail = useSessionStore((s) => s.signInWithEmail);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [providerPending, setProviderPending] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !pending;

  const handleSignIn = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const message = await signInWithEmail(email, password);
      if (message) {
        setError(message);
        return;
      }
      // Session exists and mode is now 'authenticated' (SIGNED_IN event), so
      // the root gate exposes the app content.
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const handleProvider = async (provider: OAuthProvider) => {
    setProviderPending(provider);
    setError(null);
    try {
      const result = await signInWithProvider(provider);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (!result.cancelled) router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setProviderPending(null);
    }
  };

  const providerBusy = providerPending != null;

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
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.subtitle}>
              Access your receipts, budget, and analytics.
            </Text>
          </View>

          <View style={styles.form}>
            <FieldGroup label="Email">
              <TextInput
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!pending && !providerBusy}
              />
            </FieldGroup>

            <FieldGroup label="Password">
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                placeholder="Your password"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                editable={!pending && !providerBusy}
                onSubmitEditing={handleSignIn}
                returnKeyType="go"
              />
            </FieldGroup>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={styles.primaryButton}
              onPress={handleSignIn}
              disabled={!canSubmit || providerBusy}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              {pending ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => router.push('/forgot-password')}
              disabled={pending || providerBusy}
              accessibilityRole="link"
              style={styles.inlineLinkWrap}
            >
              <Text style={styles.inlineLink}>Forgot your password?</Text>
            </Pressable>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.providers}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => handleProvider('google')}
              disabled={pending || providerBusy}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              {providerPending === 'google' ? (
                <Spinner size="sm" />
              ) : (
                <Text style={styles.secondaryButtonText}>Continue with Google</Text>
              )}
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => handleProvider('apple')}
              disabled={pending || providerBusy}
              accessibilityRole="button"
              accessibilityLabel="Continue with Apple"
            >
              {providerPending === 'apple' ? (
                <Spinner size="sm" />
              ) : (
                <Text style={styles.secondaryButtonText}>Continue with Apple</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>New to Ticketify? </Text>
            <Pressable
              onPress={() => router.push('/sign-up')}
              disabled={pending || providerBusy}
              accessibilityRole="link"
            >
              <Text style={styles.footerLink}>Create an account</Text>
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
  },
  primaryButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  inlineLinkWrap: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  inlineLink: {
    ...typography.labelSm,
    color: colors.primary,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  providers: {
    gap: spacing.md,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  footerText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  footerLink: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '600',
  },
});
