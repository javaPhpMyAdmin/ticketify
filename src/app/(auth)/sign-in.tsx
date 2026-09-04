import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FieldGroup, Pressable, Spinner, Text, View } from '@/components';
import { useSessionStore } from '@/features/auth';
import { signInWithProvider, type OAuthProvider } from '@/lib/auth/oauth';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Email/password and OAuth sign-in (user-auth spec).
 *
 * Submit is disabled while a request is in flight; every sign-in failure
 * surfaces the same generic message (the store never returns a raw GoTrue
 * message — anti-enumeration) and keeps the user on this screen. The route
 * can arrive with an `error` param from the OAuth callback route (a
 * cold-start exchange that failed), which is shown here.
 * OAuth runs the PKCE flow (ADR-3); a cancelled or failed flow leaves the
 * user here without a session.
 */
export default function SignInScreen() {
  const signInWithEmail = useSessionStore((s) => s.signInWithEmail);
  const params = useLocalSearchParams<{ error?: string | string[] }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [providerPending, setProviderPending] = useState<OAuthProvider | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // A failed cold-start OAuth exchange routes here with a user-readable
  // error param (`src/app/oauth.tsx`); surface it once on arrival.
  useEffect(() => {
    const message = Array.isArray(params.error)
      ? params.error[0]
      : params.error;
    if (message) setError(message);
  }, [params.error]);

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
      // The SIGNED_IN event set the session; the root layout's
      // session-transition effect owns navigation into the app.
    } catch {
      // signInWithEmail never rejects (every failure is mapped to the generic
      // message in the store); this is a defensive fallback with the same
      // anti-enumeration copy.
      setError('Correo o contraseña inválidos.');
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
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar sesión. Inténtalo de nuevo.',
      );
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
            <Text style={styles.title}>Iniciar sesión</Text>
            <Text style={styles.subtitle}>
              Accede a tus tickets, presupuesto y analítica.
            </Text>
          </View>

          <View style={styles.form}>
            <FieldGroup label="Correo electrónico">
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

            <FieldGroup label="Contraseña">
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                placeholder="Tu contraseña"
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
              accessibilityLabel="Iniciar sesión"
            >
              {pending ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Iniciar sesión</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => router.push('/forgot-password')}
              disabled={pending || providerBusy}
              accessibilityRole="link"
              style={styles.inlineLinkWrap}
            >
              <Text style={styles.inlineLink}>¿Olvidaste tu contraseña?</Text>
            </Pressable>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>O</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.providers}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => handleProvider('google')}
              disabled={pending || providerBusy}
              accessibilityRole="button"
              accessibilityLabel="Continuar con Google"
            >
              {providerPending === 'google' ? (
                <Spinner size="sm" />
              ) : (
                <Text style={styles.secondaryButtonText}>
                  Continuar con Google
                </Text>
              )}
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => handleProvider('apple')}
              disabled={pending || providerBusy}
              accessibilityRole="button"
              accessibilityLabel="Continuar con Apple"
            >
              {providerPending === 'apple' ? (
                <Spinner size="sm" />
              ) : (
                <Text style={styles.secondaryButtonText}>
                  Continuar con Apple
                </Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿Nuevo en Ticketify? </Text>
            <Pressable
              onPress={() => router.push('/sign-up')}
              disabled={pending || providerBusy}
              accessibilityRole="link"
            >
              <Text style={styles.footerLink}>Crear una cuenta</Text>
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
