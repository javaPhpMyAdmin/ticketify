/**
 * i18n provider — runs the one-shot boot sequence (REQ-6 / AD-9).
 *
 * Mount order on cold start:
 *
 *   1. `<I18nProvider>` mounts. Its `useEffect` (empty deps) runs once.
 *   2. `useLocaleStore.getState().hydrate()` reads `expo-secure-store`
 *      and computes `activeLocale`. Secure-store failures collapse to
 *      `'auto'` + device detection (log + continue, never throw).
 *   3. `initI18n()` initializes i18next with the bundled catalogs.
 *      Init failures (corrupt JSON, etc.) collapse to `es-AR` and the
 *      `initialized` event still fires so the boot gate unblocks.
 *   4. `onInitialized()` fires — the parent layout calls
 *      `setBooted(true)` so the `BootSplash` fades.
 *
 * `onInitialized` is the wire between the provider and the boot gate:
 * the provider owns i18n, the layout owns the splash. The event
 * subscription lives inside the provider and forwards via a single
 * callback so the layout doesn't have to import i18next directly.
 *
 * `onError` is exposed for the same reason — the parent can wire its
 * own logging/diagnostics without coupling to i18next.
 */
import i18next from 'i18next';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { initI18n } from '../config';
import { useLocaleStore } from '../stores/useLocaleStore';

export interface I18nProviderProps {
  /**
   * Tree to render once i18next is initialized. The provider wraps the
   * app's `Stack` so no `useTranslation`-based screen can mount its
   * first frame before the i18next instance exists — otherwise
   * react-i18next logs `NO_I18NEXT_INSTANCE` and renders raw keys
   * (e.g. `auth:email`) that never re-resolve.
   */
  children: ReactNode;
  /**
   * Called once after i18next resolves — fires whether init succeeded
   * OR fell back to es-AR, so the boot gate can advance either way
   * (REQ-6 scenario 2 + 3: never block the splash on i18n failure).
   */
  onInitialized?: () => void;
  /** Optional sink for i18next error diagnostics (init / changeLanguage). */
  onError?: (err: unknown) => void;
}

export function I18nProvider({
  children,
  onInitialized,
  onError,
}: I18nProviderProps) {
  // `ready` gates the first child render. i18next's init is async and
  // runs inside this component's effect — WITHOUT the gate, the Stack
  // (a sibling today) mounts its screens before `initReactI18next` has
  // registered the instance, and `useTranslation` renders raw keys that
  // never re-resolve. Rendering `null` until init completes guarantees
  // the first painted frame already has the catalogs (REQ-6).
  const [ready, setReady] = useState(false);
  // Stabilize callback identities via refs so the effect below only
  // runs the boot sequence once even when the parent re-renders with
  // fresh closures.
  const onInitRef = useRef(onInitialized);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onInitRef.current = onInitialized;
    onErrorRef.current = onError;
  }, [onInitialized, onError]);

  useEffect(() => {
    let cancelled = false;
    // Advance the boot gate exactly once. Two independent paths can
    // reach `fireInitialized` (the i18next `initialized` event AND the
    // direct call after `await initI18n()`), so without the guard the
    // parent's `onInitialized` would fire twice. React's own batching
    // hides the double `setReady`, but the user-facing callback must
    // run once (REQ-6).
    let bootAdvanced = false;

    const fireInitialized = () => {
      // Guard the unmounted case: if the provider unmounts mid-init
      // we still want to ignore the resulting `initialized` event so
      // we don't call back into a dead parent.
      if (cancelled || bootAdvanced) return;
      bootAdvanced = true;
      // Unblock the gated render so the Stack's screens can mount with
      // a fully initialized i18next instance (no raw-key first frame).
      setReady(true);
      onInitRef.current?.();
    };

    // `initialized` fires on a successful init (cold start). The
    // subscription is registered BEFORE we call `initI18n()` so a fast
    // init doesn't race past us — without this ordering the layout
    // would never see `setBooted(true)` on the first frame.
    const onInitEvent = () => fireInitialized();
    i18next.on('initialized', onInitEvent);

    const onFailedLoading = (res: string) => {
      // `failedLoading` fires when a namespace file errors. The
      // boot should still advance (the fallback catalog covers it);
      // we log + advance so the user never sees a stuck splash.
      // eslint-disable-next-line no-console
      console.warn('[i18n] failedLoading', res);
      onErrorRef.current?.(new Error(`failedLoading: ${res}`));
      fireInitialized();
    };
    i18next.on('failedLoading', onFailedLoading);

    void (async () => {
      try {
        // Hydrate the locale store from secure-store FIRST so the
        // init call below picks up the resolved active locale (manual
        // override > device detection). The 4s timeout is a boot-path
        // fail-safe: if the native secure-store bridge hangs, we must
        // still reach initI18n() or the splash stays forever (REQ-6).
        await Promise.race([
          useLocaleStore.getState().hydrate(),
          new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), 4_000),
          ),
        ]);
        await initI18n();
        // i18next v26 fires `initialized` synchronously when all
        // resources are bundled — but we also call the callback
        // directly here so the gate doesn't have to wait on event
        // ordering. Both paths converge in `fireInitialized`.
        fireInitialized();
      } catch (err) {
        // eslint-disable-next-line no-console -- boot-path diagnostic only
        console.warn('[i18n] init failed, falling back to es-AR', err);
        onErrorRef.current?.(err);
        // THE HARD-FAILURE FALLBACK: `changeLanguage` alone is a no-op
        // on an un-initialized instance, so the gate would open with no
        // catalogs and re-paint raw keys. Re-run the real init with a
        // forced `es-AR` so the fallback catalog is actually loaded
        // before we unblock children (REQ-6 scenario 3).
        try {
          await initI18n('es-AR');
        } catch (fallbackErr) {
          // eslint-disable-next-line no-console -- boot-path diagnostic only
          console.error('[i18n] fallback init also failed', fallbackErr);
          onErrorRef.current?.(fallbackErr);
        }
        fireInitialized();
      }
    })();

    return () => {
      cancelled = true;
      i18next.off('initialized', onInitEvent);
      i18next.off('failedLoading', onFailedLoading);
    };
  }, []);

  // The provider is a boot gate, not a layout wrapper: it renders
  // nothing on its own, but mounting the subtree only after i18next
  // resolves guarantees screens never paint raw keys (REQ-6). The boot
  // lifecycle (hydrate + init) lives here; the parent layout owns the
  // splash and the `initialized` event simply signals readiness.
  return ready ? children : null;
}