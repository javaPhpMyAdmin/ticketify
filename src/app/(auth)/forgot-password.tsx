import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FieldGroup, Pressable, Spinner, Text, View } from '@/components';
import { supabase } from '@/lib/supabase';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Requests a password-recovery email (user-auth spec scenario F).
 *
 * The recovery link points back at the reset-password screen through a
 * deep link (ticketify://reset-password in dev builds, exp://... in Expo
 * Go); Supabase appends the PKCE auth code to it. The redirect target
 * must be whitelisted in the dashboard, same as the OAuth one.
 */
const RECOVERY_REDIRECT = AuthSession.makeRedirectUri({ path: 'reset-password' });

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const canSubmit = email.trim().length > 0 && !pending;

  const handleSend = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: RECOVERY_REDIRECT,
      });
      if (error) {
        setError(error.message);
        return;
      }
      // Same response whether or not the address is registered: no
      // account enumeration.
      setEmailSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el correo de restablecimiento.');
    } finally {
      setPending(false);
    }
  };

  if (emailSent) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.confirmation}>
          <Text style={styles.kicker}>TICKETIFY</Text>
          <Text style={styles.title}>Revisa tu bandeja de entrada</Text>
          <Text style={styles.subtitle}>
            Si {email.trim()} está registrado, recibirás un enlace para
            restablecer la contraseña. Ábrelo en este dispositivo para elegir
            una nueva.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.replace('/sign-in')}
            accessibilityRole="button"
            accessibilityLabel="Volver a iniciar sesión"
          >
            <Text style={styles.primaryButtonText}>Volver a iniciar sesión</Text>
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
            <Text style={styles.title}>Restablecer contraseña</Text>
            <Text style={styles.subtitle}>
              Ingresa el correo de tu cuenta y te enviaremos un enlace de
              recuperación.
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
                editable={!pending}
                onSubmitEditing={handleSend}
                returnKeyType="go"
              />
            </FieldGroup>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={styles.primaryButton}
              onPress={handleSend}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Enviar enlace de restablecimiento"
            >
              {pending ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Enviar enlace de restablecimiento</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿Lo recordaste? </Text>
            <Pressable
              onPress={() => router.replace('/sign-in')}
              disabled={pending}
              accessibilityRole="link"
            >
              <Text style={styles.footerLink}>Iniciar sesión</Text>
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
