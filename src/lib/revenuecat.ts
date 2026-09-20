/**
 * RevenueCat wrapper (pro-subscription spec — REQ-PRO-1..5).
 *
 * The native module is loaded with a runtime `require` so the wrapper stays
 * usable in environments that do NOT have the native module linked
 * (Expo Go, web, or a Metro run before `pnpm install` rebuilt the dev
 * client). A top-level `import 'react-native-purchases'` would crash in
 * those environments, so this module keeps `Purchases === null` there and
 * every wrapper function returns the safe-by-default "free / unavailable"
 * path.
 *
 * `configure` is idempotent through the module-level `configured` flag: the
 * spec (REQ-PRO-1) requires the SDK to be configured once at startup, and
 * re-calling `Purchases.configure` would reset internal SDK state
 * (including the cached customerInfo), so subsequent calls become no-ops.
 *
 * The SDK's type declarations are version-specific; we accept `any` for
 * the module shape and keep all return shapes narrow here so consumers
 * (the pro store, the paywall) work with stable, hand-rolled contracts.
 * M8.1 adds unit harnesses for the wrapper's behaviour against mocks.
 */

import { withTimeout } from '@/lib/with-timeout';

// Runtime require: returns `null` when the native module is not linked
// (Expo Go / web / dev-client not rebuilt after install). Kept as `any`
// because the SDK's types are version-pinned and we want this wrapper to
// stay forward-compatible.
let Purchases: any = null;
let nativeModuleError: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const purchasesModule = require('react-native-purchases');
  // The package's CJS build exports `{ default: Purchases }` (interop
  // shape), so a raw `require` yields the namespace object and its
  // methods (`configure`, `getOfferings`) are undefined. Resolve the
  // class itself, falling back to the module when a future version
  // exports the class directly.
  Purchases = purchasesModule?.default ?? purchasesModule;
} catch (err) {
  // The native module is not linked in this environment (most commonly
  // Expo Go). Every wrapper below checks for `null` and short-circuits,
  // so the rest of the app never has to know.
  nativeModuleError = err;
}

/**
 * True iff the native RevenueCat module loaded. When this is false every
 * wrapper function returns the safe-by-default "free / unavailable" path,
 * so the gate stays `locked` until the dev client is rebuilt against the
 * installed `react-native-purchases` package.
 */
export function isNativeAvailable(): boolean {
  return Purchases != null;
}

/**
 * The captured `require` error from the native-module load attempt, or
 * `null` when the module is linked. Exposed for diagnostics: surfaces
 * WHY the wrapper is unavailable so a misconfigured install is
 * observable instead of silently degrading.
 */
export function getNativeModuleError(): unknown {
  return nativeModuleError;
}

let configured = false;

/**
 * Configures the SDK with the project's public RevenueCat API key
 * (`EXPO_PUBLIC_REVENUECAT_API_KEY`). Idempotent: the module-level
 * `configured` flag ensures the underlying `Purchases.configure` runs at
 * most once per process — REQ-PRO-1.
 *
 * Returns `true` when the SDK was actually configured, `false` when the
 * call was a no-op (already configured, missing API key, or the native
 * module is unavailable). The paywall surfaces a user-safe error message
 * when the gate is locked AND `isNativeAvailable()` is true but the key
 * is missing — that combination means the project is misconfigured.
 */
export function configure(apiKey: string): boolean {
  if (!Purchases) return false;
  if (!apiKey) return false;
  if (configured) return true;
  try {
    Purchases.configure({ apiKey });
    configured = true;
    return true;
  } catch (err) {
    console.warn('[revenuecat] configure failed:', err);
    return false;
  }
}

/** Shape we surface to callers — narrow enough to test in M8.1. */
export interface CustomerInfoSnapshot {
  isPro: boolean;
}

/**
 * The entitlement identifier configured in the RevenueCat dashboard for
 * the Pro offering. Centralized so the wrapper and the SDK configuration
 * stay in sync.
 */
export const PRO_ENTITLEMENT = 'pro';

/**
 * Reads the SDK's current `CustomerInfo` and projects the `pro`
 * entitlement to a boolean. Returns `null` when the native module is not
 * linked, so the bootstrap can leave the gate in its safe default
 * (isPro=false, isLoading=true) without throwing.
 */
export async function getCustomerInfo(): Promise<CustomerInfoSnapshot | null> {
  if (!Purchases) return null;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const isPro = customerInfo?.entitlements?.all?.[PRO_ENTITLEMENT]?.isActive === true;
    return { isPro };
  } catch (err) {
    console.warn('[revenuecat] getCustomerInfo failed:', err);
    return null;
  }
}

/** Result of an identity-bridging call (`logIn` / `logOut`). */
export interface RevenueCatIdentityResult {
  ok: boolean;
  message?: string;
}

/**
 * Bounded wait for SDK identity calls. A hung native call must never stall
 * the Pro bootstrap (gate stays locked → free users blocked from scanning)
 * or block sign-out, so `logIn` / `logOut` race against this bound. Mirrors
 * the auth restore timeout convention (10 s).
 */
export const REVENUECAT_CALL_TIMEOUT_MS = 10_000;

/** Sentinel returned by `withTimeout` when the SDK call overruns its bound. */
const IDENTITY_TIMEOUT_SENTINEL = Symbol('revenuecat-identity-timeout');

/**
 * Associates the RevenueCat app user with the Supabase UUID so purchases
 * are attributed to the real identity instead of an anonymous
 * `$RCAnonymousID` (webhook identity bridge). The SDK resolves with
 * `{ customerInfo, created }`; we tolerate that shape and only report
 * success/failure.
 *
 * Safe by default: never throws to callers. Returns `ok: false` when the
 * native module is unavailable, the SDK is not configured yet, the id is
 * empty, the call times out, or the SDK call itself fails.
 */
export async function logInRevenueCat(
  appUserId: string,
): Promise<RevenueCatIdentityResult> {
  if (!Purchases) {
    return { ok: false, message: 'Compras no disponibles en este entorno.' };
  }
  if (!appUserId.trim()) {
    return { ok: false, message: 'Identidad de compra inválida.' };
  }
  if (!configured) {
    return { ok: false, message: 'RevenueCat no está configurado.' };
  }
  try {
    const result = await withTimeout(
      Purchases.logIn(appUserId),
      REVENUECAT_CALL_TIMEOUT_MS,
      IDENTITY_TIMEOUT_SENTINEL,
    );
    if (result === IDENTITY_TIMEOUT_SENTINEL) {
      console.warn(`[revenuecat] logIn exceeded ${REVENUECAT_CALL_TIMEOUT_MS}ms`);
      return { ok: false, message: 'No se pudo vincular la cuenta de compras.' };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[revenuecat] logIn failed:', err);
    return { ok: false, message: 'No se pudo vincular la cuenta de compras.' };
  }
}

/**
 * Clears the RevenueCat app-user mapping. Idempotent and safe: a no-op
 * when the SDK is unavailable or not configured; never throws to callers.
 * Called on sign-out so the next user never inherits the previous user's
 * RevenueCat identity. Bounded so a hung native call cannot block the
 * sign-out itself.
 */
export async function logOutRevenueCat(): Promise<RevenueCatIdentityResult> {
  if (!Purchases) {
    return { ok: false, message: 'Compras no disponibles en este entorno.' };
  }
  if (!configured) {
    return { ok: false, message: 'RevenueCat no está configurado.' };
  }
  try {
    const result = await withTimeout(
      Purchases.logOut(),
      REVENUECAT_CALL_TIMEOUT_MS,
      IDENTITY_TIMEOUT_SENTINEL,
    );
    if (result === IDENTITY_TIMEOUT_SENTINEL) {
      console.warn(`[revenuecat] logOut exceeded ${REVENUECAT_CALL_TIMEOUT_MS}ms`);
      return { ok: false, message: 'No se pudo cerrar la cuenta de compras.' };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[revenuecat] logOut failed:', err);
    return { ok: false, message: 'No se pudo cerrar la cuenta de compras.' };
  }
}

/**
 * Entitlement-change listener callback projected to the `pro` boolean.
 * The SDK's `customerInfoUpdate` fires on renewal, refund, family-share
 * transfer, etc. Consumers still guard on the current user identity.
 */
export type CustomerInfoUpdateListener = (isPro: boolean) => void;

/**
 * Attaches the SDK's `customerInfoUpdate` listener. Resolves the CJS
 * interop shape (`{ default: PurchasesClass }`) ONCE, here — the module
 * load at the top of this file already unwraps `.default`, so the static
 * is directly reachable. This is the single place that owns the interop
 * knowledge; callers never raw-`require` the package.
 *
 * Returns an unsubscribe function, or `null` when the native module is
 * unavailable or registration failed.
 */
export function attachCustomerInfoListener(
  listener: CustomerInfoUpdateListener,
): (() => void) | null {
  if (!Purchases?.addCustomerInfoUpdateListener) return null;
  try {
    const handle = Purchases.addCustomerInfoUpdateListener((ci: any) => {
      const isPro = ci?.entitlements?.all?.[PRO_ENTITLEMENT]?.isActive === true;
      listener(isPro);
    });
    return () => {
      try {
        handle?.unsubscribe?.();
      } catch (err) {
        console.warn('[revenuecat] listener unsubscribe failed:', err);
      }
    };
  } catch (err) {
    console.warn('[revenuecat] listener registration failed:', err);
    return null;
  }
}

export interface PurchaseResult {
  ok: boolean;
  isPro: boolean;
  error?: string;
}

/**
 * Looks up a package by `identifier` in the current offering and
 * purchases it. Resolves with the post-purchase entitlement state plus
 * a user-safe error message on failure. The wrapper re-fetches offerings
 * on each call rather than caching them so a paywall screen that mounts
 * after the offerings changed (entitlement revoked, new product added)
 * still gets fresh data.
 */
export async function purchasePackage(identifier: string): Promise<PurchaseResult> {
  if (!Purchases) {
    return {
      ok: false,
      isPro: false,
      error: 'Compras no disponibles en este entorno.',
    };
  }
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current;
    const pkg = current?.availablePackages?.find(
      (p: { identifier: string }) => p.identifier === identifier,
    );
    if (!pkg) {
      return { ok: false, isPro: false, error: 'Plan no disponible.' };
    }
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const isPro = customerInfo?.entitlements?.all?.[PRO_ENTITLEMENT]?.isActive === true;
    return { ok: true, isPro };
  } catch (err) {
    return { ok: false, isPro: false, error: extractPurchaseError(err) };
  }
}

/**
 * Restores prior purchases (Apple/Google restore-purchase flow). Resolves
 * with the post-restore entitlement state. The store treats a successful
 * restore as the new source of truth: if it returns `isPro: true`, the
 * gate unlocks without going through a purchase.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!Purchases) {
    return {
      ok: false,
      isPro: false,
      error: 'Compras no disponibles en este entorno.',
    };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    const isPro = customerInfo?.entitlements?.all?.[PRO_ENTITLEMENT]?.isActive === true;
    return { ok: true, isPro };
  } catch (err) {
    return { ok: false, isPro: false, error: extractPurchaseError(err) };
  }
}

/** Result of opening the platform-native subscription management screen. */
export interface ManageSubscriptionsResult {
  ok: boolean;
  error?: string;
}

/**
 * Opens the platform-native subscription management screen (Google Play
 * on Android, App Store on iOS) so the user can cancel or change their
 * subscription plan. Google Play policy explicitly forbids in-app
 * cancellation of subscriptions managed by the Play Store — this is the
 * supported escape hatch (a deep-link button, NOT an in-app cancel).
 *
 * Safe by default: never throws. Returns `ok: false` when the native
 * module is unavailable or not configured; the profile UI surfaces the
 * error inline so a misconfigured install is observable instead of a
 * silent no-op.
 */
export async function showManageSubscriptions(): Promise<ManageSubscriptionsResult> {
  if (!Purchases) {
    return { ok: false, error: 'Compras no disponibles en este entorno.' };
  }
  if (!configured) {
    return { ok: false, error: 'RevenueCat no está configurado.' };
  }
  try {
    await Purchases.showManageSubscriptions();
    return { ok: true };
  } catch (err) {
    console.warn('[revenuecat] showManageSubscriptions failed:', err);
    return {
      ok: false,
      error: 'No se pudo abrir la administración de suscripción.',
    };
  }
}

/**
 * A single purchasable package surfaced by the current offering. The
 * `identifier` is what `purchasePackage()` consumes; `priceString` is the
 * localized price (e.g. "$5.99", "ARS 1.499,00") formatted by the Play
 * Store — Play requires the actual price (not a free-form label) on
 * the subscription disclosure. `period` is a localized suffix like
 * "/month" or "/year" — we use the package type (`MONTHLY` / `ANNUAL`)
 * since the SDK already maps it for us.
 */
export interface OfferingPackage {
  /** The package identifier passed to `purchasePackage()`. */
  identifier: string;
  /** Localized price from the store (includes currency symbol/format). */
  priceString: string;
}

export interface OfferingsSnapshot {
  /** The `monthly` package, or null when missing / unavailable. */
  monthly: OfferingPackage | null;
  /** The `annual` package, or null when missing / unavailable. */
  annual: OfferingPackage | null;
}

/**
 * Reads the current offering and projects its `monthly` / `annual`
 * packages to `{ identifier, priceString }`. The paywall uses the
 * identifier to call `purchasePackage()` and the priceString to render
 * the Play-compliant price disclosure. Returns `null` when the native
 * module is not linked.
 */
export async function getOfferings(): Promise<OfferingsSnapshot | null> {
  if (!Purchases) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current;
    const toPackage = (pkg: typeof current.monthly): OfferingPackage | null =>
      pkg
        ? {
            identifier: pkg.identifier,
            priceString: pkg.product.priceString ?? '',
          }
        : null;
    return {
      monthly: toPackage(current?.monthly),
      annual: toPackage(current?.annual),
    };
  } catch (err) {
    console.warn('[revenuecat] getOfferings failed:', err);
    return null;
  }
}

/**
 * Maps an SDK error to a user-safe Spanish message. The RevenueCat SDK
 * surfaces cancellation, network failure, and payment-declined through
 * a single error class — the message text is the only signal — so we
 * match common markers. Anything we cannot classify maps to a generic
 * retry message; raw SDK text never reaches the paywall.
 */
function extractPurchaseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes('cancel')) {
    return 'Compra cancelada.';
  }
  if (lower.includes('network') || lower.includes('offline')) {
    return 'Sin conexión. Reintentá la compra.';
  }
  if (lower.includes('declin') || lower.includes('payment')) {
    return 'No pudimos procesar el pago. Probá con otro método.';
  }
  return 'No se pudo completar la compra. Inténtalo de nuevo.';
}
