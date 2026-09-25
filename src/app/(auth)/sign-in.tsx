import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FieldGroup, GoogleG, Logo, PasswordField, Pressable, Spinner, Text, View } from '@/components';
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
  // Synchronous re-entrancy gate. The visual `pending` /
  // `providerPending` state below drives the Pressable's `disabled`
  // wiring; `inFlightRef` is the gate that actually prevents two
  // parallel `signInWithEmail` (or two parallel OAuth intents) when
  // a user double-taps the same button in the same JS tick — React
  // state reads from a stale closure until the next render, but a
  // ref read is synchronous. We use BOTH together: the ref blocks
  // the second tap before render; the state flows to the disabled
  // prop on the next paint. `inFlightSignInRef` and
  // `inFlightProviderRef` are kept separate so email-password and
  // OAuth can each be in-flight at once (those are independent
  // network calls).
  const inFlightSignInRef = useRef(false);
  const inFlightProviderRef = useRef(false);

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

  // Blur validation: surface each field's error when the user LEAVES it
  // with content (never on a never-touched, empty field — that would
  // pre-mark the form before first interaction). Typing clears the error
  // (onChangeText below) and submit re-runs the validators as the
  // fallback, so the two paths agree.
  const handleEmailBlur = () => {
    if (email.trim().length > 0) setEmailFieldError(validateEmail(email));
  };
  const handlePasswordBlur = () => {
    if (password.length > 0) {
      setPasswordFieldError(validateSignInPassword(password));
    }
  };

  const handleSignIn = async () => {
    // Synchronous `inFlightRef` gate — see the block comment above
    // on the `inFlightSignInRef` declaration. The visual `pending`
    // state drives the Pressable's `disabled` prop on the next
    // paint; this ref blocks the second tap before that re-render.
    if (inFlightSignInRef.current) return;
    inFlightSignInRef.current = true;
    try {
      const emailErr = validateEmail(email);
      const passwordErr = validateSignInPassword(password);
      setEmailFieldError(emailErr);
      setPasswordFieldError(passwordErr);
      if (emailErr || passwordErr) return;
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
    } finally {
      // Always release the gate, including the throw-paths above
      // (`return;` mid-body still falls through here because the
      // `try` covers it).
      inFlightSignInRef.current = false;
    }
  };

  const handleProvider = async (provider: OAuthProvider) => {
    // Synchronous `inFlightRef` gate (TOCTOU-resistant) — visual
    // `providerPending` state drives the disabled prop; this ref
    // blocks the second tap before that re-render lands.
    if (inFlightProviderRef.current) return;
    inFlightProviderRef.current = true;
    try {
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
    } finally {
      inFlightProviderRef.current = false;
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
            <View style={styles.logoWrap}>
              <Logo />
            </View>
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
                onBlur={handleEmailBlur}
              />
            </FieldGroup>

            <FieldGroup
              label={t('auth:password')}
              error={
                passwordFieldError ? t(`auth:${passwordFieldError}`) : undefined
              }
            >
              <PasswordField
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setPasswordFieldError(null);
                }}
                placeholder={t('auth:passwordPlaceholder')}
                error={
                  passwordFieldError ? t(`auth:${passwordFieldError}`) : undefined
                }
                autoComplete="current-password"
                textContentType="password"
                editable={!pending && !providerBusy}
                onBlur={handlePasswordBlur}
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
    alignItems: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
    textAlign: 'center',
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
