import { useState } from 'react';
import { StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, IconButton, Pressable, Text, View } from '@/components';
import { useReceiptDraftActions } from '@/features/tickets';
import { tempId } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

export default function CameraScreen() {
  const [busy, setBusy] = useState(false);
  const { startDraft, setError } = useReceiptDraftActions();

  const handleCapture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Se necesita permiso de cámara para escanear recibos.');
        router.back();
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: true,
        aspect: [3, 4],
        cameraType: ImagePicker.CameraType.back,
      });
      if (result.canceled || !result.assets?.[0]) {
        // User cancelled — just go back.
        router.back();
        return;
      }
      const asset = result.assets[0];
      startDraft(asset.uri);
      router.replace(`/ticket/review/${tempId()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido de la cámara.';
      setError(message);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  const handlePickFromGallery = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Se necesita acceso a tus fotos para importar recibos.');
        router.back();
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: true,
        aspect: [3, 4],
      });
      if (result.canceled || !result.assets?.[0]) {
        router.back();
        return;
      }
      const asset = result.assets[0];
      startDraft(asset.uri);
      router.replace(`/ticket/review/${tempId()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido de la galería.';
      setError(message);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <SafeAreaView style={styles.topBar} edges={['top']}>
          <IconButton
            icon="xmark"
            iconSize={22}
            color={colors.textInverse}
            backgroundColor="rgba(0,0,0,0.4)"
            onPress={() => router.back()}
            accessibilityLabel="Cerrar cámara"
          />
          <View style={{ flex: 1 }} />
          {/* Flash toggle stub — real impl needs expo-camera which is not installed. */}
          <IconButton
            icon="bolt.fill"
            iconSize={20}
            color={colors.textInverse}
            backgroundColor="rgba(0,0,0,0.4)"
            disabled
            accessibilityLabel="Activar flash"
          />
        </SafeAreaView>

        <View style={styles.placeholder}>
          <View style={styles.frame}>
            <Text style={styles.hint}>Apunta la cámara al recibo</Text>
            {/* In-app preview stub — real impl needs expo-camera which is not installed. */}
            <Text style={styles.subHint}>
              La cámara nativa se abre al tocar el botón de captura.
            </Text>
          </View>
        </View>

        <SafeAreaView style={styles.bottomBar} edges={['bottom']}>
          <Pressable
            style={styles.galleryButton}
            onPress={handlePickFromGallery}
            disabled={busy}
            accessibilityLabel="Elegir de la galería"
          >
            <Icon name="photo" size={22} color={colors.textInverse} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.shutterOuter,
              { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
            ]}
            onPress={handleCapture}
            disabled={busy}
            accessibilityLabel="Capturar recibo"
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.galleryButton} />
        </SafeAreaView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  frame: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  hint: {
    ...typography.headlineMd,
    color: colors.textInverse,
    textAlign: 'center',
  },
  subHint: {
    ...typography.bodyMd,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  galleryButton: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  shutterOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.textInverse,
  },
});
