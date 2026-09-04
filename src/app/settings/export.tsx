import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, EmptyState, Icon, Pressable, Spinner, Text, View } from '@/components';
import {
  buildExportCsv,
  buildExportHtml,
  buildExportPdf,
  pluralize,
  useExportRows,
} from '@/features/export';
import { colors, radii, spacing, typography } from '@/theme';

/** The two supported export formats; CSV is the default selection. */
type ExportFormat = 'csv' | 'pdf';

/** User-safe copy when the export/share step itself fails. */
const EXPORT_ERROR_MESSAGE = 'No se pudieron exportar los tickets. Inténtalo de nuevo.';

/** Local `YYYY-MM-DD` for the export filename ("today" for the user). */
function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Full-screen receipt exporter reached from the profile screen's
 * "Export data" row (`/settings/export`). Loads the user's confirmed
 * purchases through `useExportRows` and shares them as a CSV file
 * (written to the app cache via expo-file-system's new `File`/`Paths` API)
 * or as a PDF (HTML rendered by `expo-print`). Every failure — read or
 * share — maps to a user-safe message; the button is disabled while
 * exporting so the action can never fire twice.
 */
export default function ExportScreen() {
  const { rows, isLoading, error, hasData, refetch } = useExportRows();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const itemCount = rows.reduce((sum, row) => sum + (row.items?.length ?? 0), 0);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    // Capture the selection BEFORE any await: the toggle is disabled while
    // exporting, but the format state must not change under an in-flight
    // export (e.g. a slow `isAvailableAsync` native round-trip).
    const selectedFormat = format;
    try {
      const sharingAvailable = await Sharing.isAvailableAsync();
      if (!sharingAvailable) {
        setExportError('Compartir no está disponible en este dispositivo.');
        return;
      }
      if (selectedFormat === 'csv') {
        const file = new File(Paths.cache, `ticketify-recibos-${todayISO()}.csv`);
        file.create({ overwrite: true });
        file.write(buildExportCsv(rows));
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Exportar tickets',
        });
      } else {
        const uri = await buildExportPdf(buildExportHtml(rows));
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      }
    } catch (err) {
      // A native failure (write/share) must never crash the screen or leave
      // an unhandled rejection — log it for the team and surface the
      // user-safe copy instead (same pattern as `home/api.ts`).
      console.warn('[export] share failed:', err);
      setExportError(EXPORT_ERROR_MESSAGE);
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Icon name="arrow.left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Exportar datos</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.centered}>
            <Spinner size="lg" />
          </View>
        ) : error && !hasData ? (
          <EmptyState
            icon="exclamationmark.triangle.fill"
            title={error}
            actionLabel="Reintentar"
            onAction={refetch}
            framed
          />
        ) : rows.length === 0 ? (
          <View style={styles.emptySection}>
            <EmptyState
              icon="square.and.arrow.up"
              title="Todavía no hay tickets para exportar"
              body="Tus tickets confirmados van a aparecer acá."
              framed
            />
            <Pressable
              disabled
              style={styles.exportButton}
              accessibilityRole="button"
              accessibilityLabel="Exportar tickets"
            >
              <Text style={styles.exportButtonText}>Exportar</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Card>
              <Text style={styles.cardTitle}>Resumen</Text>
              <Text style={styles.summaryText}>
                {rows.length} {pluralize(rows.length, 'ticket', 'tickets')} ·{' '}
                {itemCount} {pluralize(itemCount, 'artículo', 'artículos')}
              </Text>
            </Card>

            {/* Background refetch failed but TanStack kept the last good
                read on screen — keep the data and add a subtle inline note
                so the user knows it may be stale (sibling pattern to
                `(tabs)/index.tsx`). */}
            {hasData && error ? (
              <Text style={styles.error}>
                No se pudo actualizar. Mostrando datos guardados.
              </Text>
            ) : null}

            <Card>
              <Text style={styles.cardTitle}>Formato</Text>
              <View style={styles.formatRow}>
                {(['csv', 'pdf'] as const).map((option) => {
                  const selected = format === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => {
                        setFormat(option);
                        setExportError(null);
                      }}
                      disabled={exporting}
                      style={[
                        styles.formatOption,
                        selected && styles.formatOptionSelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Formato ${option.toUpperCase()}`}
                    >
                      <Text
                        style={[
                          styles.formatLabel,
                          selected && styles.formatLabelSelected,
                        ]}
                      >
                        {option.toUpperCase()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            {exportError ? (
              <Text style={styles.error}>{exportError}</Text>
            ) : null}

            <Pressable
              onPress={handleExport}
              disabled={exporting}
              style={styles.exportButton}
              accessibilityRole="button"
              accessibilityLabel="Exportar tickets"
            >
              {exporting ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.exportButtonText}>Exportar</Text>
              )}
            </Pressable>
          </>
        )}
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
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  centered: {
    paddingVertical: spacing.xxl * 2,
    alignItems: 'center',
  },
  emptySection: {
    gap: spacing.lg,
  },
  cardTitle: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  summaryText: {
    ...typography.bodyLg,
    color: colors.textPrimary,
  },
  formatRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  formatOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  formatOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  formatLabel: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  formatLabelSelected: {
    color: colors.primaryDark,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
  exportButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  exportButtonText: {
    ...typography.bodyMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
});
