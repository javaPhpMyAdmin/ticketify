import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Text, View } from '@/components';
import type esARLegal from '@/i18n/locales/es-AR/legal.json';
import type { LegalDocument } from '@/lib/legal-urls';
import { colors, spacing, typography } from '@/theme';

/**
 * One bound chunk of legal copy (a numbered policy/terms section).
 *
 * The type is derived from the es-AR catalog — the legal source of truth
 * (`src/i18n/types.ts` types it exactly; en/pt-BR are `Partial`
 * translations whose KEY SETS are pinned identical by the
 * test:legal-content parity harness, REQ-2).
 */
type LegalSection = (typeof esARLegal)['privacy']['sections'][number];

interface LegalScreenProps {
  /** Which bundled document to render (`privacy` | `terms` → `/legal/*`). */
  document: LegalDocument;
}

/**
 * In-app legal document screen (legal-compliance U2, AD-1: static RN Text,
 * no runtime fetch). Reads the CURRENT locale's `legal` namespace through
 * `useTranslation`, so a locale swap re-renders the document in the active
 * language. The header back button uses `common:back` for its
 * accessibility label and `router.back()` for navigation — the same
 * contract as the category drill-down. The visible draft notice on every
 * document keeps the pending-legal-review copy clearly marked (design R-3).
 */
export default function LegalScreen({ document }: LegalScreenProps) {
  const { t } = useTranslation(['legal', 'common']);
  // Dotted `legal:${document}.…` keys narrow to the two documents the
  // routes can pass (privacy/terms) — both exist in every locale catalog.
  // The `as string` casts are no-ops against the real i18next types (the
  // keys resolve to strings) and let the isolated RENDER harness compile
  // the screen against the legal-i18next test double (which returns
  // `unknown`): same cast pattern as `DatePickerField/calendar.ts`.
  const title = t(`legal:${document}.title`) as string;
  const draftNotice = t(`legal:${document}.draftNotice`) as string;
  // The sections array is resolved with `returnObjects` (i18next returns
  // the array verbatim) and cast to the es-AR-derived section shape — the
  // same pattern `DatePickerField/calendar.ts` uses for the date arrays.
  const sections = t(`legal:${document}.sections`, {
    returnObjects: true,
  }) as readonly LegalSection[];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common:back') as string}
        >
          <Icon name="arrow.left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.draftNotice}>{draftNotice}</Text>
        {sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}

        {/* Safety-net footer: the legal docs are reachable pre-auth and
            post-gate, but `router.back()` is a dead-end if there's no Stack
            history (e.g. user signs out from the consent gate — the
            post-signOut landing was /legal/privacy with no way out). A
            explicit sign-in link gives the user an escape hatch regardless
            of how they landed here. i18n: `legalScreenSignIn` /
            `legalScreenSignInHint`. */}
        <View style={styles.footer}>
          <Text style={styles.footerHint}>
            {t('legal:legalScreenSignInHint') as string}
          </Text>
          <Pressable
            onPress={() => router.replace('/sign-in')}
            accessibilityRole="link"
            accessibilityLabel={t('legal:legalScreenSignIn') as string}
          >
            <Text style={styles.footerLinkText}>
              {t('legal:legalScreenSignIn') as string}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  draftNotice: {
    ...typography.labelSm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.bodyLg,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  sectionBody: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  footer: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerHint: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  footerLink: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  footerLinkText: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '700',
  },
});