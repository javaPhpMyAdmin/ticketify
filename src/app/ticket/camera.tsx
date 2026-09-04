import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, IconButton, Pressable, Text, View } from '@/components';
import { useReceiptDraftActions } from '@/features/tickets';
import { warmUpParseTicket } from '@/features/tickets/api';
import { pickBestPictureSize } from '@/features/tickets/lib/picture-size';
import { tempId } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

// NOTE: expo-camera ships a native module, so the dev client needs a rebuild
// (`pnpm ios` / `pnpm android`) to pick it up after installing expo-camera.

export default function CameraScreen() {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  // The preview needs a few hundred ms to initialize on cold open; expo-camera
  // throws on takePictureAsync before onCameraReady fires, so the shutter is
  // gated on this flag (see handleCapture).
  const [isCameraReady, setIsCameraReady] = useState(false);
  // Captures at a capped resolution (see pickBestPictureSize): the parse
  // pipeline base64-encodes the photo and sends it to Gemini, so a full 8MP
  // sensor shot (multi-MB JPEG) makes the upload and the model slow — and can
  // push the whole invoke past the 30s client timeout. A ~1280px capture keeps
  // the receipt readable while staying well inside the timeout budget.
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  // In-screen error for the capture/gallery flows. The store's `setError`
  // writes a field nothing reads (the review screen surfaces the mutation
  // error instead), so failures are ALSO shown here and the user stays on the
  // camera to retry — the X button is the only exit on error.
  const [captureError, setCaptureError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView | null>(null);
  const { startDraft, setError } = useReceiptDraftActions();
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (!isCameraReady || !cameraRef.current) return;
    let cancelled = false;
    cameraRef.current
      .getAvailablePictureSizesAsync()
      .then((sizes) => {
        if (!cancelled) setPictureSize(pickBestPictureSize(sizes));
      })
      // Non-fatal: falls back to the sensor's default resolution.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isCameraReady]);

  // Pre-warm the Gemini model once per screen visit so the real parse call
  // (~30s later) hits a warm instance instead of paying the ~47s cold-start.
  const warmupFired = useRef(false);
  useEffect(() => {
    if (warmupFired.current) return;
    warmupFired.current = true;
    void warmUpParseTicket();
  }, []);

  const handleCapture = async () => {
    if (busy || !isCameraReady) return;
    setBusy(true);
    setCaptureError(null);
    try {
      if (!cameraRef.current) {
        throw new Error('Cámara no disponible.');
      }
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo) {
        // Camera produced no picture — stay on screen so the user can retry
        // instead of being kicked out.
        setCaptureError('No se pudo capturar el ticket. Inténtalo de nuevo.');
        return;
      }
      startDraft(photo.uri);
      router.replace(`/ticket/review/${tempId()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido de la cámara.';
      setError(message);
      setCaptureError(message);
    } finally {
      setBusy(false);
    }
  };

  const handlePickFromGallery = async () => {
    if (busy) return;
    setBusy(true);
    setCaptureError(null);
    try {
      const galleryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!galleryPermission.granted) {
        // Media-library denial is NOT a camera failure: stay on screen with an
        // explanation (the X button remains the exit). This path is reachable
        // from the camera-permission gate too, where backing out would strand
        // the user.
        setError('Se necesita acceso a tus fotos para importar tickets.');
        setCaptureError('Se necesita acceso a tus fotos para importar tickets.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: Platform.OS === 'ios',
        aspect: Platform.OS === 'ios' ? [3, 4] : undefined,
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
      setCaptureError(message);
    } finally {
      setBusy(false);
    }
  };

  const toggleFlash = () => setFlash((mode) => (mode === 'off' ? 'on' : 'off'));

  // Shared by both branches so the gallery entry point stays reachable even
  // when the camera permission is denied — the gallery flow only needs the
  // media-library permission, so the shutter (and the camera) are the only
  // parts the permission gate should remove.
  const renderBottomBar = (withShutter: boolean) => (
    <SafeAreaView style={styles.bottomBar} edges={['bottom']}>
      <Pressable
        style={styles.galleryButton}
        onPress={handlePickFromGallery}
        disabled={busy}
        accessibilityLabel="Elegir de la galería"
      >
        <Icon name="photo" size={22} color={colors.textInverse} />
      </Pressable>
      {withShutter ? (
        <Pressable
          style={({ pressed }) => [
            styles.shutterOuter,
            { opacity: busy || !isCameraReady ? 0.6 : pressed ? 0.85 : 1 },
          ]}
          onPress={handleCapture}
          disabled={busy || !isCameraReady}
          accessibilityLabel="Capturar ticket"
        >
          <View style={styles.shutterInner} />
        </Pressable>
      ) : null}
      <View style={styles.gallerySpacer} />
    </SafeAreaView>
  );

  const renderErrorBanner = () =>
    captureError ? (
      <View style={styles.errorBanner}>
        <Text style={styles.errorBannerText}>{captureError}</Text>
      </View>
    ) : null;

  if (!permission || !permission.granted) {
    // Permanent denial: on Android the user checked "don't ask again"
    // (`canAskAgain === false`) and on iOS any denial is final (the OS never
    // re-prompts, and expo-modules-core reports `canAskAgain === false`
    // whenever the status is `denied`). In both cases `requestPermission()`
    // resolves immediately without prompting, so the "Permitir acceso"
    // button would be a silent dead-end — show settings guidance instead.
    // The gallery button stays visible below: importing a receipt only needs
    // the media-library permission, which is independent of the camera.
    const settingsRequired =
      permission != null &&
      permission.status === 'denied' &&
      !permission.canAskAgain;
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
            <View style={styles.topBarSpacer} />
          </SafeAreaView>
          <View style={styles.permissionState}>
            <Icon name="camera.fill" size={44} color={colors.textSecondary} />
            <Text style={styles.permissionMessage}>
              {settingsRequired
                ? 'Para escanear tickets, activa el acceso a la cámara desde los Ajustes.'
                : 'Se necesita permiso de cámara para escanear tickets.'}
            </Text>
            <Pressable
              style={styles.permissionButton}
              onPress={
                settingsRequired
                  ? () => Linking.openSettings()
                  : () => void requestPermission()
              }
              accessibilityLabel={
                settingsRequired ? 'Abrir Ajustes' : 'Permitir acceso'
              }
            >
              <Text style={styles.permissionButtonText}>
                {settingsRequired ? 'Abrir Ajustes' : 'Permitir acceso'}
              </Text>
            </Pressable>
          </View>
          {renderErrorBanner()}
          {renderBottomBar(false)}
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          flash={flash}
          pictureSize={pictureSize}
          onCameraReady={() => setIsCameraReady(true)}
        />
        <SafeAreaView style={styles.topBar} edges={['top']}>
          <IconButton
            icon="xmark"
            iconSize={22}
            color={colors.textInverse}
            backgroundColor="rgba(0,0,0,0.4)"
            onPress={() => router.back()}
            accessibilityLabel="Cerrar cámara"
          />
          <View style={styles.topBarSpacer} />
          <IconButton
            icon="bolt.fill"
            iconSize={20}
            color={flash === 'on' ? colors.primary : colors.textInverse}
            backgroundColor="rgba(0,0,0,0.4)"
            onPress={toggleFlash}
            accessibilityLabel={flash === 'on' ? 'Apagar flash' : 'Activar flash'}
          />
        </SafeAreaView>

        {renderErrorBanner()}
        {renderBottomBar(true)}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    // Pins the top bar to the top and the capture controls to the bottom. The
    // removed capture-frame overlay used to absorb the vertical space with its
    // `flex: 1`; without it, the bottom bar would sit right under the top bar.
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  // Pushes the X (left) and flash (right) to the edges. Must be transparent:
  // the `View` atom defaults to the theme background, which painted a white
  // bar across the top of the dark camera screen.
  topBarSpacer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  permissionState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    // The `View` atom defaults to the theme background (offWhite). This state
    // sits over the dark camera container, so it must stay transparent to keep
    // the white text readable.
    backgroundColor: 'transparent',
  },
  permissionMessage: {
    ...typography.headlineMd,
    color: colors.textInverse,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  permissionButton: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  permissionButtonText: {
    ...typography.bodyMd,
    color: colors.textInverse,
    fontWeight: '700',
  },
  errorBanner: {
    // Keeps the banner pinned just above the capture bar: the container uses
    // `space-between`, so without an auto top margin the banner floats
    // vertically centered over the preview.
    marginTop: 'auto',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorBannerText: {
    ...typography.labelSm,
    color: colors.textInverse,
    textAlign: 'center',
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
  // Invisible column that mirrors the gallery button width so the shutter
  // stays centered under `space-between`. Deliberately has no background —
  // styling it like a button made it look tappable when it does nothing.
  gallerySpacer: {
    width: 56,
    height: 56,
    backgroundColor: 'transparent',
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
