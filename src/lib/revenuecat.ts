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

// Runtime require: returns `null` when the native module is not linked
// (Expo Go / web / dev-client not rebuilt after install). Kept as `any`
// because the SDK's types are version-pinned and we want this wrapper to
// stay forward-compatible.
let Purchases: any = null;
let nativeModuleError: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Purchases = require('react-native-purchases');
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

export interface OfferingsSnapshot {
  /** The `monthly` package identifier, or null when missing / unavailable. */
  monthly: string | null;
  /** The `annual` package identifier, or null when missing / unavailable. */
  annual: string | null;
}

/**
 * Reads the current offering and projects its `monthly` / `annual`
 * packages to their identifiers. The paywall uses these identifiers to
 * render the buy buttons and to call `purchasePackage(identifier)`. Returns
 * `null` when the native module is not linked.
 */
export async function getOfferings(): Promise<OfferingsSnapshot | null> {
  if (!Purchases) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current;
    return {
      monthly: current?.monthly?.identifier ?? null,
      annual: current?.annual?.identifier ?? null,
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
