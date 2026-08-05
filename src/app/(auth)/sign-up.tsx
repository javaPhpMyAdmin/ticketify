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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta. Inténtalo de nuevo.');
    } finally {
      setPending(false);
    }
  };

  if (confirmationSent) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.confirmation}>
          <Text style={styles.kicker}>TICKETIFY</Text>
          <Text style={styles.title}>Revisa tu bandeja de entrada</Text>
          <Text style={styles.subtitle}>
            Si esta dirección es nueva, te enviamos un enlace de confirmación.
            Ábrelo para activar tu cuenta y luego vuelve para iniciar sesión.
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
            <Text style={styles.title}>Crear cuenta</Text>
            <Text style={styles.subtitle}>
              Regístrate con tu correo para empezar a registrar tus recibos.
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
              />
            </FieldGroup>

            <FieldGroup
              label="Contraseña"
              helper="Al menos 8 caracteres."
            >
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                placeholder="Elige una contraseña"
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
              accessibilityLabel="Crear cuenta"
            >
              {pending ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Crear cuenta</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿Ya tienes una cuenta? </Text>
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
