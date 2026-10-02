import { useEffect } from 'react';

import { setCurrencySymbolGate } from '@/lib/format';
import { useSettingsStore } from '@/stores/use-settings-store';

import { useProfile } from '../hooks/useProfile';

/**
 * Bridges the store's hydration flag into the formatter's module-level
 * currency-symbol gate. Renders nothing.
 *
 * ── Why this is a component at all ───────────────────────────────────────
 * `formatCurrency` is called from plain functions all over the app, so the
 * gate cannot live in the store: the store is a React/zustand concern and
 * importing it into `lib/format` would invert the dependency direction of a
 * module that is deliberately dependency-free. The bridge has to be something
 * that mounts exactly once, above every money screen — that is a component.
 *
 * ── Why the MOUNT belongs at the root layout, not the profile screen ─────
 * The gate has to be shut for the WHOLE session, not while the profile tab is
 * on screen. A profile-tab mount is wrong twice over:
 *
 *   1. The user opens the app on Home or Analytics. Those screens render
 *      amounts. With the mount inside `(tabs)/profile.tsx`, `Tab.Screen`
 *      mounts lazily, so the flag never flips and every amount on Home shows
 *      without a currency unit.
 *   2. `Stack.Protected` only ever renders its declared `Stack.Screen`
 *      children. Anything else dropped inside it is dropped from the tree, so
 *      a sibling there would never mount at all.
 *
 * Mounting at the root and gating the mount itself on a session keeps the
 * fail-closed window as short as the profile read itself.
 *
 * ── The subscribe/unsubscribe pair ───────────────────────────────────────
 * Mounting closes the gate synchronously in the effect body (before any
 * money screen's own effect can format). The subscription then pushes every
 * later transition into the module, and the unsubscribe on teardown re-closes
 * it — so a remount (Fast Refresh, a session flip that re-gates this
 * component) can never leave the gate open with no owner. Session teardown
 * itself also calls `resetHydration()`, so the flag is shut even during the
 * window where this component is unmounted.
 */
export function ProfileHydration() {
  const currencyHydrated = useSettingsStore((s) => s.currencyHydrated);
  const currency = useProfile().user?.currency;

  useEffect(() => {
    // Fail closed on mount, and on every currency change while the gate is
    // still shut: a NEW session reusing a cached profile row must not inherit
    // the previous user's symbol before its own row is confirmed.
    setCurrencySymbolGate(false);
  }, [currency]);

  useEffect(() => {
    setCurrencySymbolGate(currencyHydrated);
  }, [currencyHydrated]);

  useEffect(() => () => setCurrencySymbolGate(false), []);

  return null;
}