import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Pressable, Text, View } from '@/components';
import { colors, spacing, typography } from '@/theme';

export default function ScanTabScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Pressable
        style={styles.cta}
        onPress={() => router.push('/ticket/camera')}
        accessibilityRole="button"
        accessibilityLabel="Open the camera to scan a receipt"
      >
        <View style={styles.iconWrap}>
          <Icon name="camera.fill" size={48} color={colors.textInverse} />
        </View>
        <Text style={styles.title}>Escanear Ticket</Text>
        <Text style={styles.subtitle}>Tap to open the camera</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  cta: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.headlineLg,
    color: colors.textInverse,
    fontSize: 32,
  },
  subtitle: {
    ...typography.bodyLg,
    color: colors.textInverse,
    opacity: 0.85,
  },
});
