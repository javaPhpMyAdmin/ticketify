import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
import i18next from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DialogHost, ToastHost } from '@/components';
import { BootSplash } from '@/components/molecules/BootSplash';
import { useSessionStore } from '@/features/auth';
import { ProBootstrap } from '@/features/pro';
import { I18nProvider } from '@/i18n/components/I18nProvider';
import { decideSessionNavigation } from '@/lib/auth/session-nav';
import { queryClient } from '@/lib/query-client';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

/**
 * Root gate (ADR-5): app content is registered inside a Stack.Protected
 * that is only visible when a session exists. Sign-in is mandatory from
 * launch — there is no data-source mode to reconcile:
 *
 * - session (restored, signed in, recovered) → gate open
 * - no session (fresh install, signed out, expired token) → gate closed;
 *   (auth) screens are the only registered routes, so the sign-in screen
 *   becomes the initial route.
 *
 * The splash stays up until the stored session restore resolves, so there
 * is no flash of the wrong screen.
 */
export default function RootLayout() {
  const restore = useSessionStore((s) => s.restore);
  const isBootstrapping = useSessionStore((s) => s.isBootstrapping);
  const session = useSessionStore((s) => s.session);
  const prevSession = useRef(session);
  const pathname = usePathname();

  // Single owner of "go to app" navigation. The decision is a pure function
  // (`decideSessionNavigation` in src/lib/auth/session-nav.ts, unit-tested in
  // the auth harness) with two independent conditions, both suppressed on
  // `/reset-password` (that screen owns its exit: the recovery exchange signs
  // in with a recovery session before the user picks a new password, so this
  // effect must not steal it):
  //
  // 1. The session flipped from null to a session — the gate has committed
  //    `(tabs)` by the time this effect runs, so the replace can never race
  //    the Stack.Protected guard (ADR: auth gate). This covers email
  //    sign-in/sign-up and the OAuth cold-start exchange.
  // 2. A session is present while `/oauth` is on screen, with no null→session
  //    flip observed by this effect (warm race after the flip was consumed,
  //    or a stored-session cold start where `prevSession` was never null).
  //    The callback screen (`src/app/oauth.tsx`) deliberately yields to this
  //    effect instead of navigating itself: the gate is always committed
  //    before the replace targets `(tabs)`, and there is never a second
  //    navigation racing the first.
  //
  // The deep-link intent is derived from `pathname` (reactive), never from a
  // `Linking.getInitialURL()` snapshot: a non-reactive ref write would leave
  // the decision depending on the promise ordering between the session
  // restore/flip and the initial-URL delivery.
  useEffect(() => {
    const decision = decideSessionNavigation({
      prevSession: prevSession.current,
      session,
      pathname,
    });
    if (decision.shouldNavigate) {
      router.replace(decision.target);
    }
    prevSession.current = session;
  }, [session, pathname]);

  const [booted, setBooted] = useState(false);

  useEffect(() => {
    restore();
  }, [restore]);

  // ── i18n boot gate (REQ-6 / AD-9) ──────────────────────────────────
  // We subscribe to i18next's `initialized` event so `setBooted(true)`
  // only fires after the catalogs are loaded — the first frame must
  // show localized labels, never raw keys. The provider emits this
  // event from inside its boot sequence, but subscribing at the layout
  // level keeps the gate co-located with `BootSplash`. The
  // `failedLoading` fallback mirrors the same logic for the rare case
  // where a namespace file fails to parse: advance the gate anyway so
  // the splash never gets stuck (the `I18nProvider` already falls back
  // to `es-AR` internally).
  useEffect(() => {
    const advance = () => setBooted(true);
    i18next.on('initialized', advance);
    i18next.on('failedLoading', advance);
    return () => {
      i18next.off('initialized', advance);
      i18next.off('failedLoading', advance);
    };
  }, []);

  // Paint the native root view once so pop/modal transitions never flash
  // the system background (black in dark mode) between frames — the Stack
  // `contentStyle` only covers the navigator content, not the window that
  // shows through during dismiss animations.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {
      // safe to ignore — unsupported on some platforms; contentStyle still covers it
    });
  }, []);

  // Combined readiness: auth bootstrap AND i18n init both finished. The
  // i18n effect above flips `booted` on the `initialized` event; the
  // auth effect below flips it when `isBootstrapping` clears. Both must
  // be true before the splash fades.
  useEffect(() => {
    if (!isBootstrapping && i18next.isInitialized) setBooted(true);
  }, [isBootstrapping]);

  const [bootSplashVisible, setBootSplashVisible] = useState(true);

  return (
    // GestureHandlerRootView must wrap the entire app: gesture-handler
    // routes native touches through its root view, so any screen using
    // `GestureDetector` (e.g. the receipt photo fullscreen pinch-zoom)
    // needs the root wrap. Without it, gestures silently no-op.
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" backgroundColor={colors.background} />
        {/* i18n boot (REQ-6 / AD-9): hydrates the locale store from
            secure-store, calls `i18next.init()` once, and fires the
            `initialized` event so the boot gate above can advance. The
            provider WRAPS the Stack and renders its children only after
            i18next resolves — without the wrap, the Stack's screens
            mount their first frame before `initReactI18next` registers
            the instance and `useTranslation` paints raw keys (e.g.
            `auth:email`) that never re-resolve (react-i18next
            NO_I18NEXT_INSTANCE). */}
        <I18nProvider
          onInitialized={() => setBooted(true)}
          onError={(err) => {
            // eslint-disable-next-line no-console -- boot-path diagnostic only
            console.warn('[i18n] boot error', err);
          }}
        >
          <ProBootstrap />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Protected guard={session != null}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="ticket/camera"
                options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="ticket/review/[id]"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              {/* Manual entry: a modal form (like the review) reached from the
                  home "Cargar compra" FAB. Lives behind the session gate — it
                  writes the user's draft and calls save_receipt. */}
              <Stack.Screen
                name="ticket/manual"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen name="categories/[key]" />
              {/* The drill-downs render store data and are reached from the
                  Home/History drill-downs, so they must sit behind the same
                  session gate — without this they auto-register outside the
                  guard and render stale data via deep links when signed out. */}
              <Stack.Screen name="receipts/[id]" />
              <Stack.Screen name="items/[name]" />
              {/* Store drill-down: reached from the Pro charts screen
                  (`/pro/charts` StoreBars tap). Reads the same user-scoped
                  receipts store, so it must live behind the session gate
                  alongside the item / receipt drill-downs. */}
              <Stack.Screen name="stores/[name]" />
      {/* Renders the user's current currency and writes their profile
                   row, so it must sit behind the same session gate (same
                   rationale as the drill-downs below). */}
              <Stack.Screen name="settings/currency" />
              {/* Same rationale as the currency screen: the budget editor
                   writes the user's profile row and renders their current
                   monthly cap, so it lives behind the session gate. */}
              <Stack.Screen name="settings/budget" />
              {/* Pro paywall + Pro-gated charts placeholder. The paywall is
                  session-gated only (free users reach it to upgrade); the
                  charts screen enforces its Pro gate inside the screen body
                  (ProRouteGuard). The per-screen titles are NOT declared here:
                  `pro/index` sets its own `<Stack.Screen options>` inline and
                  `pro/charts` uses `useScreenTitle('pro:chartsTitle')` (AD-11)
                  — the screen-level options win at runtime, so layout titles
                  would be dead code. */}
              <Stack.Screen name="pro/index" />
              <Stack.Screen name="pro/charts" />
            </Stack.Protected>
            <Stack.Screen name="(auth)" />
          </Stack>
        </I18nProvider>
        {/* Mounted at the root so it survives route navigation: a
            `show()` call from a screen about to `router.back()` keeps the
            toast visible on the destination screen instead of dying with
            the source route. */}
        <ToastHost />
        {/* Root-mounted so a `show()` survives navigation, same as the
            toast host. Renders a centered overlay View (not Modal) above
            the Stack — see DialogHost for the layering tradeoff. */}
        <DialogHost />
        {/* Branded splash overlay: hides the native splash on its first
            frame and fades out once the session reconciled (`booted`). */}
        {bootSplashVisible ? (
          <BootSplash
            booted={booted}
            onFinish={() => setBootSplashVisible(false)}
          />
        ) : null}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
