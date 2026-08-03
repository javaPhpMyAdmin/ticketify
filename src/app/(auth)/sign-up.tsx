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
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Email/password sign-up (user-auth spec).
 *
 * When email confirmation is enabled the account is created without a
 * session and the user is told to check their inbox (sign-up spec
 * scenario C); otherwise the SIGNED_IN event fires and the root gate
 * exposes the app content.
 */
export default function SignUpScreen() {
  const signUpWithEmail = useSessionStore((s) => s.signUpWithEmail);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const canSubmit =
    email.trim().length > 0 && password.length >= 8 && !pending;

  const handleSignUp = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const result = await signUpWithEmail(email, password);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.needsEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed. Please try again.');
    } finally {
      setPending(false);
    }
  };

  if (confirmationSent) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.confirmation}>
          <Text style={styles.kicker}>TICKETIFY</Text>
          <Text style={styles.title}>Check your inbox</Text>
          <Text style={styles.subtitle}>
            If this address is new, we sent a confirmation link. Open it to
            activate your account, then come back and sign in.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.replace('/sign-in')}
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
          >
            <Text style={styles.primaryButtonText}>Back to Sign In</Text>
          </Pressable>
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
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>
              Sign up with your email to start tracking receipts.
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
                editable={!pending}
              />
            </FieldGroup>

            <FieldGroup
              label="Password"
              helper="At least 8 characters."
            >
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                placeholder="Choose a password"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!pending}
                onSubmitEditing={handleSignUp}
                returnKeyType="go"
              />
            </FieldGroup>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={styles.primaryButton}
              onPress={handleSignUp}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Create account"
            >
              {pending ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Pressable
              onPress={() => router.replace('/sign-in')}
              disabled={pending}
              accessibilityRole="link"
            >
              <Text style={styles.footerLink}>Sign in</Text>
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
  confirmation: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
});
