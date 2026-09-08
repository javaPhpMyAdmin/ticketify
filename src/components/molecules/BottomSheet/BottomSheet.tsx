import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Divider, Icon, Text } from '@/components';
import { colors, radii, spacing, typography } from '@/theme';

export type BottomSheetCloseIcon = 'xmark' | 'text';
export type BottomSheetKeyboardMode = 'none' | 'avoidingView' | 'listeners';

export interface BottomSheetProps {
  /** Whether the sheet is open. Kept mounted so closing animates. */
  visible: boolean;
  /**
   * Close handler. Passed through TAL CUAL to the native `Modal`
   * (`onRequestClose`) and the close/backdrop press — the sheet never
   * intercepts or reorders it. Consumers own any confirm-after-dismissal
   * logic (they may `setTimeout` their own work past the slide animation;
   * the sheet just calls `onClose` synchronously on dismissal).
   */
  onClose: () => void;

  /** Optional uppercase kicker shown above the title (labelCaps). */
  kicker?: string;
  /** Optional title (headlineMd). Omit both to render no text column. */
  title?: string;
  /** Close affordance look. Default `'xmark'`; `'text'` renders a `✕`. */
  closeIcon?: BottomSheetCloseIcon;
  /**
   * Render the close button in the header. Set `false` for sheets with no
   * close affordance at all (e.g. the category picker, which dismisses on
   * backdrop tap or selection only). When set to `false` AND no
   * `kicker`/`title` is given, the header row is skipped entirely.
   * Default `true`.
   */
  showCloseButton?: boolean;
  /** Accessibility label for the backdrop pressable. Default `'Cerrar'`. */
  backdropLabel?: string;
  /** Accessibility label for the close button. Default `'Cerrar'`. */
  closeLabel?: string;

  /** Max height of the sheet. Default `'80%'`. */
  maxHeight?: DimensionValue;
  /** Pre-dismissal back layer color. Default the shared `rgba(0,0,0,0.45)`. */
  backdropColor?: string;
  /** Use `colors.surface` (not `background`) as the sheet fill. Default `false`. */
  surface?: boolean;
  /** Top corner radius token. Default `'lg'`. */
  radius?: 'lg' | 'xl';

  /**
   * Android keyboard strategy. A transparent `Modal` NEVER receives
   * `windowSoftInputMode="adjustResize"`, so the two modes are opt-in:
   *   - `'avoidingView'`: `KeyboardAvoidingView` (reliable on iOS).
   *   - `'listeners'`: offset body content by the REAL keyboard height via
   *     `keyboardDidShow`/`keyboardDidHide` (works on both platforms).
   *   - `'none'` (default): no keyboard handling.
   */
  keyboardMode?: BottomSheetKeyboardMode;
  /**
   * Wrap `children` in a `ScrollView` with `flexShrink: 1` (NOT `flex: 1`,
   * which collapses a content-sized sheet to 0) so long content scrolls
   * without overflowing the `maxHeight`. Default `false`.
   */
  scrollable?: boolean;
  /** Body style applied to the scroll content. Ignored when `scrollable` is false. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Render a full-width hairline `Divider` right after the header (before
   * the body). Some consumers (e.g. Rename/ItemEditor) put a divider under
   * the header; others don't. Default `false`.
   */
  divider?: boolean;
  /**
   * When `false`, dismissal (system back, backdrop tap, close button) is
   * suppressed — used while an async save is in flight. Default `true`.
   */
  dismissable?: boolean;

  children?: ReactNode;
}

/**
 * Shared bottom-sheet shell for the 9+ modal sheets in the app.
 *
 * Extracts the duplicated chrome (transparent slide-up `Modal`, dimmed
 * backdrop with a behind-sheet tap layer, handle bar, header with optional
 * kicker/title + close button, safe-area body, Android keyboard modes) so
 * each modal becomes a thin content wrapper.
 *
 * Behavioural contracts preserved:
 *   - `onClose` is passed unchanged to the native `Modal`(no reordering).
 *   - The `Modal` stays mounted between `visible` flips so closing animates
 *     and consumer-owned state (drafts, refs) is never remounted.
 *   - Only `Pressable`/`ScrollView` — no gesture-handler (gestures inside a
 *     native `Modal` are unreliable on Android).
 *   - When `keyboardMode === 'listeners'`, buffers are NOT reseeded here:
 *     the keyboard height is merely measured so consumers keep their own
 *     buffer identity/reseed-on-open logic untouched.
 */
export function BottomSheet({
  visible,
  onClose,
  kicker,
  title,
  closeIcon = 'xmark',
  backdropLabel = 'Cerrar',
  closeLabel = 'Cerrar',
  showCloseButton = true,
  maxHeight = '80%',
  backdropColor = 'rgba(0,0,0,0.45)',
  surface = false,
  radius = 'lg',
  keyboardMode = 'none',
  scrollable = false,
  contentContainerStyle,
  divider = false,
  dismissable = true,
  children,
}: BottomSheetProps) {
  // Height of the software keyboard while the sheet is open (`listeners`
  // mode only). A transparent RN `Modal` on Android never receives
  // `windowSoftInputMode="adjustResize"`, so `KeyboardAvoidingView` cannot
  // reliably lift input there. `keyboardDidShow`/`keyboardDidHide` give the
  // REAL height on both platforms without `Platform` hacks.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (keyboardMode !== 'listeners') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [keyboardMode]);

  // Drop any stale keyboard height from a previous session when the sheet
  // re-opens (the keyboard re-fires `keyboardDidShow` right after open).
  useEffect(() => {
    if (visible && keyboardMode === 'listeners') {
      setKeyboardHeight(0);
    }
  }, [visible, keyboardMode]);

  // `onClose` passthrough — only gated by `dismissable` (WU4 keeps async
  // saves from tearing the sheet down mid-flight). Never reorders the callback.
  const requestClose = () => {
    if (dismissable) onClose();
  };

  const sheetStyle = [
    styles.sheet,
    {
      backgroundColor: surface ? colors.surface : colors.background,
      borderTopLeftRadius: radius === 'xl' ? radii.xl : radii.lg,
      borderTopRightRadius: radius === 'xl' ? radii.xl : radii.lg,
      maxHeight,
    },
  ];

  const header =
    kicker || title || showCloseButton ? (
      <View style={[styles.header, kicker && !title && styles.headerCentered]}>
        {kicker || title ? (
          <View style={styles.headerText}>
            {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
            {title ? <Text style={styles.title}>{title}</Text> : null}
          </View>
        ) : null}
        {showCloseButton ? (
          <Pressable
            onPress={requestClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            style={styles.closeButton}
          >
            {closeIcon === 'text' ? (
              <Text style={styles.closeX}>✕</Text>
            ) : (
              <Icon name="xmark" size={22} color={colors.textPrimary} />
            )}
          </Pressable>
        ) : null}
      </View>
    ) : null;

  const body = scrollable ? (
    <ScrollView
      style={styles.scrollBody}
      contentContainerStyle={[
        contentContainerStyle,
        keyboardMode === 'listeners' && {
          paddingBottom: keyboardHeight + spacing.lg,
        },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    children
  );

  const backdropProps = {
    style: [styles.backdrop, { backgroundColor: backdropColor }],
  };

  const shell = (
    <SafeAreaView style={sheetStyle} edges={['bottom']}>
      <View style={styles.handle} />
      {header}
      {divider ? <Divider /> : null}
      {body}
    </SafeAreaView>
  );

  // `avoidingView` wraps the whole backdrop in KeyboardAvoidingView so the
  // sheet lifts above the keyboard (KeyboardAvoidingView on the class-B
  // group). The backdrop tap layer stays a PREV sibling of the sheet so
  // tapping the sheet's own area never closes it.
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={requestClose}
      statusBarTranslucent
    >
      {keyboardMode === 'avoidingView' ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={backdropProps.style}
        >
          <Pressable
            style={styles.backdropTouch}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel={backdropLabel}
          />
          {shell}
        </KeyboardAvoidingView>
      ) : (
        <View style={backdropProps.style}>
          <Pressable
            style={styles.backdropTouch}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel={backdropLabel}
          />
          {shell}
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  // Pressable layer that catches taps outside the sheet — sits BEHIND the
  // sheet but covers the rest of the screen so `onPress` closes the modal
  // even on the dimmed area. It's a previous sibling of the sheet, so a tap
  // on the sheet's own area never reaches it.
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.sm,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerCentered: {
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  closeX: {
    fontSize: 20,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  // The scroll container must NOT stretch (`flex: 1` / `flexBasis: 0`):
  // the sheet sizes itself by content (only `maxHeight` is set), so a
  // zero-basis flex child collapses to 0 height and hides the body.
  // `flexShrink: 1` keeps content height but lets the sheet compress on
  // small screens or when keyboard padding exceeds `maxHeight`.
  scrollBody: {
    flexShrink: 1,
  },
});

export default BottomSheet;
