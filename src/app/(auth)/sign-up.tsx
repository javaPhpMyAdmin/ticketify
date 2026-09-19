import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FieldGroup, Pressable, Spinner, Text, View } from '@/components';
import { useSessionStore } from '@/features/auth';
import {
  LATEST_LEGAL_VERSIONS,
  pendingAcceptanceStore,
} from '@/features/legal';
import { openLegalDocument } from '@/lib/legal-navigation';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Email/password sign-up (user-auth spec).
 *
 * When email confirmation is enabled the account is created without a
 * session and the user is told to check their inbox (sign-up spec
 * scenario C); otherwise the SIGNED_IN event fires and the root gate
 * exposes the app content.
 *
 * Legal-consent (legal-compliance U5, AD-9/AD-10): the form requires
 * explicit acceptance of the privacy policy + terms (checkbox gates
 * submit; the `signUpConsentRequired` message appears on an unchecked
 * submit attempt). Before the network sign-up call, the pending flag is
 * stored with the typed email so the acceptances can be replayed once a
 * session exists (queue-then-flush; flushPendingAcceptance on SIGNED_IN
 * in the session store). The footer opens the documents IN-APP so they
 * stay readable pre-auth and without an external browser.
 */
export default function SignUpScreen() {
  const { t } = useTranslation(['auth', 'settings', 'legal']);
  const signUpWithEmail = useSessionStore((s) => s.signUpWithEmail);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    consentAccepted &&
    !pending;

  const handleConsentToggle = () => {
    setConsentAccepted((accepted) => {
      const next = !accepted;
      if (next) setConsentError(null);
      return next;
    });
  };

  const handleSignUp = async () => {
    if (email.trim().length === 0 || password.length < 8 || pending) return;
    if (!consentAccepted) {
      setConsentError(t('legal:signUpConsentRequired'));
      return;
    }
    setPending(true);
    setError(null);
    setConsentError(null);
    try {
      // Queue-then-flush: write the pending flag BEFORE the network call so
      // a session starting concurrently (or one that already exists) can
      // replay these acceptances. Failures here must NOT block sign-up —
      // the flag is best-effort (SecureStore write; warned, not thrown).
      try {
        await pendingAcceptanceStore.write({
          email: email.trim().toLowerCase(),
          version: LATEST_LEGAL_VERSIONS.privacy,
          acceptedAt: new Date().toISOString(),
        });
      } catch (storageErr) {
        // eslint-disable-next-line no-console -- queue failure is non-fatal
        console.warn('[sign-up] could not queue legal acceptance', storageErr);
      }
      const result = await signUpWithEmail(email, password);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.needsEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth:couldNotCreateAccount'));
    } finally {
      setPending(false);
    }
  };

  if (confirmationSent) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.confirmation}>
          <Text style={styles.kicker}>{t('auth:kicker')}</Text>
          <Text style={styles.title}>{t('auth:checkInboxTitle')}</Text>
          <Text style={styles.subtitle}>
            {t('auth:checkInboxSignUp')}
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.replace('/sign-in')}
            accessibilityRole="button"
            accessibilityLabel={t('auth:backToSignIn')}
          >
            <Text style={styles.primaryButtonText}>{t('auth:backToSignIn')}</Text>
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
            <Text style={styles.kicker}>{t('auth:kicker')}</Text>
            <Text style={styles.title}>{t('auth:signUp')}</Text>
            <Text style={styles.subtitle}>{t('auth:signUpTagline')}</Text>
          </View>

          <View style={styles.form}>
            <FieldGroup label={t('auth:email')}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                placeholder={t('auth:emailPlaceholder')}
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
              label={t('auth:password')}
              helper={t('auth:newPasswordHelper')}
            >
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                placeholder={t('auth:passwordChoosePlaceholder')}
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

            {/* Explicit legal consent (U5, AD-10): the checkbox itself is a
                single toggle Pressable; the document names in the label are
                the SAME strings the footer links below (which open in-app),
                so there is no dead-end from this row. The composed label
                reads "Al continuar aceptás la Política de privacidad y los
                Términos y Condiciones" — prefix + settings labels. */}
            <Pressable
              style={styles.consentRow}
              onPress={handleConsentToggle}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consentAccepted }}
              accessibilityLabel={t('legal:signUpConsentRequired')}
            >
              <View
                style={[
                  styles.checkbox,
                  consentAccepted ? styles.checkboxChecked : styles.checkboxUnchecked,
                ]}
              >
                {consentAccepted ? (
                  <Text style={styles.checkboxMark}>{'\u2713'}</Text>
                ) : null}
              </View>
              <Text style={styles.consentText}>
                {t('auth:signUpLegalPrefix')}{' '}
                <Text style={styles.consentLinkText}>
                  {t('settings:privacyPolicy')}
                </Text>{' '}
                {t('auth:signUpLegalAnd')}{' '}
                <Text style={styles.consentLinkText}>
                  {t('settings:termsConditions')}
                </Text>
              </Text>
            </Pressable>
            {consentError ? <Text style={styles.error}>{consentError}</Text> : null}

            <Pressable
              style={styles.primaryButton}
              onPress={handleSignUp}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel={t('auth:signUp')}
            >
              {pending ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>{t('auth:signUp')}</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('auth:alreadyHaveAccount')}</Text>
            <Pressable
              onPress={() => router.replace('/sign-in')}
              disabled={pending}
              accessibilityRole="link"
            >
              <Text style={styles.footerLink}>{t('auth:signIn')}</Text>
            </Pressable>
          </View>

          {/* Legal links below the footer pairing (REQ-4): usable pre-auth and
              opened IN-APP (AD-8) — the navigator import carries no session
              or auth modules, and the routes live outside Stack.Protected. */}
          <View style={styles.legalFooter}>
            <Text style={styles.legalText}>{t('auth:signUpLegalPrefix')}</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('settings:privacyPolicy')}
              onPress={() => openLegalDocument('privacy')}
            >
              <Text style={styles.legalLink}>{t('settings:privacyPolicy')}</Text>
            </Pressable>
            <Text style={styles.legalText}>{t('auth:signUpLegalAnd')}</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('settings:termsConditions')}
              onPress={() => openLegalDocument('terms')}
            >
              <Text style={styles.legalLink}>{t('settings:termsConditions')}</Text>
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
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
  },
  checkboxUnchecked: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  checkboxMark: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  consentText: {
    ...typography.labelSm,
    color: colors.textSecondary,
    flex: 1,
  },
  consentLinkText: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '600',
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
  legalFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xxl,
    gap: spacing.xs,
  },
  legalLink: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '600',
  },
  legalText: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  confirmation: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
});
