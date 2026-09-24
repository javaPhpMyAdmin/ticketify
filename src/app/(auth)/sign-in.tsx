import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { FieldGroup, Pressable, Spinner, Text, View } from '@/components';
import { useSessionStore } from '@/features/auth';
import { signInWithProvider, type OAuthProvider } from '@/lib/auth/oauth';
import {
  validateEmail,
  validateSignInPassword,
  type EmailErrorKey,
  type PasswordErrorKey,
} from '@/lib/auth/validation';
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
  const { t } = useTranslation(['auth']);
  const signInWithEmail = useSessionStore((s) => s.signInWithEmail);
  const params = useLocalSearchParams<{ error?: string | string[] }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailFieldError, setEmailFieldError] = useState<EmailErrorKey | null>(
    null,
  );
  const [passwordFieldError, setPasswordFieldError] =
    useState<PasswordErrorKey | null>(null);
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

  const providerBusy = providerPending != null;

  const canSubmit = !pending && !providerBusy;

  const handleSignIn = async () => {
    const emailErr = validateEmail(email);
    const passwordErr = validateSignInPassword(password);
    setEmailFieldError(emailErr);
    setPasswordFieldError(passwordErr);
    if (emailErr || passwordErr) return;
    if (pending || providerBusy) return;
    setPending(true);
    setError(null);
    try {
      const message = await signInWithEmail(email.trim(), password);
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
      setError(t('auth:invalidCredentials'));
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
          : t('auth:couldNotStartSession'),
      );
    } finally {
      setProviderPending(null);
    }
  };

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
            <Text style={styles.kicker}>{t('auth:kicker')}</Text>
            <Text style={styles.title}>{t('auth:signIn')}</Text>
            <Text style={styles.subtitle}>{t('auth:tagline')}</Text>
          </View>

          <View style={styles.form}>
            <FieldGroup
              label={t('auth:email')}
              error={
                emailFieldError ? t(`auth:${emailFieldError}`) : undefined
              }
            >
              <TextInput
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setEmailFieldError(null);
                }}
                style={styles.input}
                placeholder={t('auth:emailPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!pending && !providerBusy}
              />
            </FieldGroup>

            <FieldGroup
              label={t('auth:password')}
              error={
                passwordFieldError ? t(`auth:${passwordFieldError}`) : undefined
              }
            >
              <TextInput
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setPasswordFieldError(null);
                }}
                style={styles.input}
                placeholder={t('auth:passwordPlaceholder')}
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
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel={t('auth:signIn')}
            >
              {pending ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>{t('auth:signIn')}</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => router.push('/forgot-password')}
              disabled={pending || providerBusy}
              accessibilityRole="link"
              style={styles.inlineLinkWrap}
            >
              <Text style={styles.inlineLink}>{t('auth:forgotPassword')}</Text>
            </Pressable>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>{t('auth:or')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.providers}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => handleProvider('google')}
              disabled={pending || providerBusy}
              accessibilityRole="button"
              accessibilityLabel={t('auth:continueWithGoogle')}
            >
              {providerPending === 'google' ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <GoogleG />
                  <Text style={styles.secondaryButtonText}>
                    {t('auth:continueWithGoogle')}
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('auth:newToTicketify')}</Text>
            <Pressable
              onPress={() => router.push('/sign-up')}
              disabled={pending || providerBusy}
              accessibilityRole="link"
            >
              <Text style={styles.footerLink}>{t('auth:createAccountLink')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Official multi-color Google "G" glyph (canonical 48x48 path data).
 * Decorative inside the "Continue with Google" button: the Pressable
 * already carries the accessible label, so the glyph is hidden from
 * screen readers on both platforms.
 */
function GoogleG() {
  return (
    <Svg
      width={20}
      height={20}
      viewBox="0 0 48 48"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
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
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
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
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
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
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
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
