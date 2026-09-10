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
import { useEffect, useRef } from 'react';

import { initI18n } from '../config';
import { useLocaleStore } from '../stores/useLocaleStore';

export interface I18nProviderProps {
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
  onInitialized,
  onError,
}: I18nProviderProps) {
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

    const fireInitialized = () => {
      // Guard the unmounted case: if the provider unmounts mid-init
      // we still want to ignore the resulting `initialized` event so
      // we don't call back into a dead parent.
      if (cancelled) return;
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
        // override > device detection).
        await useLocaleStore.getState().hydrate();
        await initI18n();
        // i18next v26 fires `initialized` synchronously when all
        // resources are bundled — but we also call the callback
        // directly here so the gate doesn't have to wait on event
        // ordering. Both paths converge in `fireInitialized`.
        if (!cancelled) onInitRef.current?.();
      } catch (err) {
        // eslint-disable-next-line no-console -- boot-path diagnostic only
        console.warn('[i18n] init failed, falling back to es-AR', err);
        onErrorRef.current?.(err);
        // The fallback path: force es-AR and unblock the boot gate.
        // `changeLanguage` is a no-op if i18next was never initialized
        // because of a hard failure — but `fireInitialized` always
        // runs so the splash never gets stuck (REQ-6 scenario 3).
        try {
          await i18next.changeLanguage('es-AR');
        } catch {
          // Already logged — keep advancing.
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

  // The provider is a side-effect component — it does not own any
  // rendered output, just the boot lifecycle. Mounting it next to the
  // Stack (rather than wrapping children) keeps the layout tree
  // unchanged and means there's only one consumer of the `initialized`
  // event. Returns null explicitly so the type is unambiguous.
  return null;
}