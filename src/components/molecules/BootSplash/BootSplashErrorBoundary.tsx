import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { colors } from '@/theme';

export interface BootSplashErrorBoundaryProps {
  /**
   * Called when the wrapped boot overlay throws during render (e.g.
   * `react-native-svg` crashes on a path, font resolution fails on
   * Android, an asset decode panics). The contract: the boundary
   * logs the exception in dev and surfaces a minimal text fallback
   * for one render cycle, then unmounts via `onFinish` so the rest
   * of the app underneath proceeds — preventing the "blank screen
   * forever after `SplashScreen.hideAsync`" class of bug.
   */
  onFinish?: () => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Last-line-of-defense boundary around the boot splash.
 *
 * Why this exists (resilience review — pre-commit fix):
 * `<BootSplash>` renders a static SVG (`<SplashBrandMark>`). The
 * splash is mounted above the app from cold start; once its first
 * frame paints, the parent has already called `SplashScreen.hideAsync`
 * to close the native splash. If the SVG / `react-native-svg`
 * crashes for any reason (font resolution on certain Android
 * vendors, a malformed path on a renderer quirk, a missing asset),
 * BootSplash re-throws and React unmounts it — the user is left
 * staring at the native splash close with nothing painted behind
 * it. This boundary catches that throw, paints a single bare
 * `<Text>` fallback ("Ticketify"), then calls `onFinish` so the
 * parent's `bootSplashVisible` flips false and the underlying layout
 * mounts. The app proceeds.
 *
 * The fallback has NO SVG, NO worklet runtime, NO `Animated` — it
 * is the absolute simplest surface that can paint, which is
 * exactly the point: even if every other component on the boot
 * path is broken, a `<Text>` with the brand word still gets the
 * user off the native splash.
 *
 * Kept as a class component because functional ErrorBoundaries are
 * not supported by React (the `componentDidCatch` lifecycle has no
 * hook equivalent). Intentionally minimal: no state-management
 * library, no `react-error-boundary` dep, no `getDerivedStateFromError`
 * fanout — only the two ErrorBoundary-specific methods plus the
 * render.
 */
export class BootSplashErrorBoundary extends Component<
  BootSplashErrorBoundaryProps,
  State
> {
  state: State = { hasError: false };

  /**
   * Triggers a re-render with `hasError: true` so `render()` returns
   * the fallback tree. React guarantees this runs during the commit
   * phase, so it's the only place we can read an exception's side
   * effects synchronously without tripping a setState-in-render
   * warning.
   */
  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  /**
   * Side-effect hook for the exception: log it (dev only — production
   * crash reporting would hook in here, but RN runtime here doesn't
   * wire Sentry so the console stays the canonical place) and ask
   * the parent to unmount the overlay so the underlying app can
   * mount.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[BootSplash] render exception', error, info.componentStack);
    }
    // Belt-and-braces: if BootSplash's first render threw BEFORE its own
    // mount-effect ran `SplashScreen.hideAsync`, the native splash stays
    // opaque on top of this fallback. Dismiss it here so the user never
    // sees a white frame even in the worst-case render exception path.
    SplashScreen.hideAsync().catch(() => {
      // safe to ignore — already hidden or interrupted by another call
    });
    this.props.onFinish?.();
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // The fallback exists for exactly one render cycle — the parent
      // reads `onFinish` synchronously and unmounts the boundary
      // before the next paint. The Text ensures we never serve a
      // white frame in that window.
      return (
        <View
          style={styles.fallback}
          accessibilityRole="progressbar"
          accessibilityLabel="Cargando"
          pointerEvents="none"
        >
          <Text style={styles.fallbackText}>Ticketify</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Match the boot overlay's zIndex so the fallback stays above
    // any toast/dialog for the single frame it survives — the
    // parent's onFinish already has the boundary queued for
    // unmount on the next tick.
    zIndex: 1002,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
