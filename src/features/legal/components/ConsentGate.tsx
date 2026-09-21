/**
 * Blocking legal-consent gate (legal-compliance U5, AD-6).
 *
 * Root-mounted overlay (DialogHost pattern) driven by the pure
 * `shouldShowConsentGate(status, pathname)` decision: while a session exists
 * and either document lacks a current-version acceptance row, the gate covers
 * the app so ONLY the legal screens, the accept action, and sign-out are
 * reachable — no dead-ends. It hides itself on `/legal/*` so the documents
 * stay readable while gated.
 *
 * The query only runs once a userId exists (the layout passes `session.user.id`
 * and the overlay returns null while `loading`), so there is no gate flash on
 * relaunch: a signed-in user with rows goes straight through, and a gated user
 * sees the overlay as soon as the read settles. Accept writes BOTH rows at the
 * LATEST version through `recordAcceptance`, invalidates the query, and the
 * re-read releases the gate; a failed write surfaces the user-safe message and
 * keeps the gate up (R-5 — consent is never assumed from missing data).
 */
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Spinner, Text, View } from '@/components';
import { openLegalDocument } from '@/lib/legal-navigation';
import { colors, radii, spacing, typography } from '@/theme';

import { shouldShowConsentGate } from '../legal-consent';
import { useLegalConsent } from '../use-legal-consent';

interface ConsentGateProps {
  /** The signed-in user's id; null before any session exists. */
  userId: string | null;
  /** Sign-out action (from the session store) — the gate's second escape hatch. */
  onSignOut: () => void;
}

export function ConsentGate({ userId, onSignOut }: ConsentGateProps) {
  const { t } = useTranslation(['legal', 'settings', 'auth']);
  const pathname = usePathname();
  const { status, accept, isAccepting, isError } = useLegalConsent(userId ?? '');

  if (!shouldShowConsentGate(status, pathname)) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('legal:consentGateTitle') as string}</Text>
        <Text style={styles.body}>{t('legal:consentGateBody') as string}</Text>

        {/* The documents the user is being asked to accept — readable from
            inside the gate, no acceptance required to open them. */}
        <View style={styles.linksRow}>
          <Text style={styles.linkText}>{t('auth:signUpLegalPrefix') as string}</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('settings:privacyPolicy') as string}
            onPress={() => openLegalDocument('privacy')}
          >
            <Text style={styles.link}>{t('settings:privacyPolicy') as string}</Text>
          </Pressable>
          <Text style={styles.linkText}>{t('auth:signUpLegalAnd') as string}</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('settings:termsConditions') as string}
            onPress={() => openLegalDocument('terms')}
          >
            <Text style={styles.link}>{t('settings:termsConditions') as string}</Text>
          </Pressable>
        </View>

        {isError ? (
          <Text style={styles.error}>
            {t('legal:acceptanceErrorMessage') as string}
          </Text>
        ) : null}

        <Pressable
          style={styles.acceptButton}
          onPress={() => {
            // Fire-and-forget: the failure surfaces through `error`; the catch
            // only guards against an unhandled rejection reaching the runtime.
            accept().catch(() => {});
          }}
          disabled={isAccepting}
          accessibilityRole="button"
          accessibilityLabel={t('legal:consentGateAccept') as string}
        >
          {isAccepting ? (
            <Spinner size="sm" color={colors.onPrimary} />
          ) : (
            <Text style={styles.acceptButtonText}>
              {t('legal:consentGateAccept') as string}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={styles.signOutButton}
          onPress={onSignOut}
          accessibilityRole="button"
          accessibilityLabel={t('legal:consentGateSignOut') as string}
        >
          <Text style={styles.signOutButtonText}>
            {t('legal:consentGateSignOut') as string}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    // Above the DialogHost (zIndex 1001) so the gate is the top-most
    // blocking surface — a consent gate must never sit under a dialog.
    zIndex: 1002,
    elevation: 1002,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  linksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  link: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  linkText: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
    textAlign: 'center',
  },
  acceptButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  acceptButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  signOutButtonText: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '700',
  },
});