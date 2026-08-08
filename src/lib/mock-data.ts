/**
 * Dev-only mock fixtures for the offline flows — lets the Home tab render a
 * budget, a scan quota, and a session-backed feed without real Supabase rows
 * or a signed-in account, and lets a mocked save land in the Home feed.
 *
 * Enable with `EXPO_PUBLIC_MOCK_DATA=1` (fixtures for budget / scan usage /
 * receipt save) and `EXPO_PUBLIC_MOCK_AUTH=1` (session injected at launch)
 * in `.env`. Env vars are inlined at build time by Expo, so restart the dev
 * server after changing them.
 *
 * The flags are a set: `MOCK_AUTH=1` without `MOCK_DATA=1` (or vice versa)
 * yields a half-mock app that fires real Supabase reads keyed on the mock
 * identity. `EXPO_PUBLIC_MOCK_PARSE=1` (see `features/tickets/lib/mock-parse`)
 * is the third flag that stubs the scan/parse step, so the full offline flow
 * is the three flags together.
 *
 * SECURITY: every flag is also gated on `__DEV__`. Expo inlines
 * `EXPO_PUBLIC_*` into every build profile, so without this gate a Release /
 * EAS build would compile the mock branches — booting the app signed in as
 * the mock identity and bypassing GoTrue entirely. `__DEV__` is false in
 * release builds, which kills the whole mock layer there.
 *
 * The fixtures mirror the real read shapes: `MOCK_MONTHLY_BUDGET` matches
 * what `fetchMonthlyBudget` returns, `mockScanUsage()` the `scan_usage` row
 * `fetchScanUsage` reads, and `MOCK_SESSION` a supabase-js `Session` with a
 * fake identity that the auth store and session-gated queries consume.
 */
import type { Session } from '@supabase/supabase-js';

import type { MonthlyBudget } from '@/features/budget/api';
import { USE_MOCK_PARSE } from '@/features/tickets/lib/mock-parse';
import type { PurchaseStatus, ScanUsage } from '@/types';

export const USE_MOCK_DATA =
  __DEV__ && process.env.EXPO_PUBLIC_MOCK_DATA === '1';

export const USE_MOCK_AUTH =
  __DEV__ && process.env.EXPO_PUBLIC_MOCK_AUTH === '1';

// Half-mock misconfiguration is invisible until a real Supabase read fires
// keyed on the mock identity (or the scan step hits the network while the
// feed stays local). Warn at module load so the mistake shows immediately
// instead of surfacing as a confusing runtime failure.
if (USE_MOCK_PARSE && !USE_MOCK_DATA) {
  console.warn(
    '[mock] EXPO_PUBLIC_MOCK_PARSE=1 without EXPO_PUBLIC_MOCK_DATA=1: the scan step is mocked but the feed/budget stay real.',
  );
}
if (USE_MOCK_AUTH && !USE_MOCK_DATA) {
  console.warn(
    '[mock] EXPO_PUBLIC_MOCK_AUTH=1 without EXPO_PUBLIC_MOCK_DATA=1: the session is mocked but data reads stay real.',
  );
}

/** The monthly budget the budget card renders offline (ARS, like mock-parse). */
export const MOCK_MONTHLY_BUDGET: MonthlyBudget = {
  amount: 45000,
  currency: 'ARS',
};

/**
 * The current month's `scan_usage` row, mirroring the prod quota counters
 * (10 of 100 scans used). `userId` / `yearMonth` come from the caller so the
 * fixture respects the same read params as the real row.
 */
export function mockScanUsage(userId: string, yearMonth: string): ScanUsage {
  return {
    user_id: userId,
    year_month: yearMonth,
    scans_used: 10,
    scans_limit: 100,
  };
}

/**
 * Supabase-shaped session for the mock identity. Only the fields the app
 * actually reads matter (user id, email, full name, avatar) — the tokens are
 * inert because mock mode never calls Supabase with them.
 */
export const MOCK_SESSION: Session = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: {
    id: 'mock-user-0001',
    email: 'mara@test.dev',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {
      full_name: 'Mara Test',
      avatar_url: null,
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
  },
};

/**
 * `YYYY-MM-DD` for `days` days before today, in local calendar time (a UTC
 * slice would drift a day for late-evening timestamps in UTC-x zones). The
 * mock fixtures call it at module load so receipt dates stay relative to
 * launch day: the Home feed keeps landing in the current month and the
 * History tab always has a previous month to navigate to.
 */
export function daysAgoISO(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` for `days` days before today, in local calendar time, but
 * never before the first day of the CURRENT month: on days 1–11 of any
 * month a pure day offset spills into the previous month, and Home's
 * current-month view (`currentMonthKey()`) renders empty. The current-month
 * mock receipts use this so the demo always fills Home regardless of launch
 * day; the previous-month seed uses `previousMonthISO` so the History tab
 * always has a previous month to navigate to.
 */
export function currentMonthDaysAgoISO(days: number): string {
  const today = new Date();
  const day = Math.max(1, today.getDate() - days);
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(day).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

/**
 * `YYYY-MM-DD` reliably inside the PREVIOUS month (the 15th), in local
 * calendar time. Unlike a fixed `daysAgoISO` offset — which on the first
 * days of a month lands two months back — this always seeds the previous
 * month, so the History tab and the price-alert pair stay anchored no
 * matter which day the app launches.
 */
export function previousMonthISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 12 : month;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}-15`;
}

/**
 * Seeded receipts for the Home feed offline. Without these the feed renders
 * one row at most (whatever was saved this session) and the screen ends
 * halfway down, leaving an empty band under the floating scan FAB. Several
 * stores also make the "Categorías de gastos" strip meaningful (aggregated
 * per category in mock mode). Purchase dates are anchored to the current
 * month (`currentMonthDaysAgoISO`): the current-month receipts fill Home no
 * matter which day the app launches (pure day offsets would spill into the
 * previous month on days 1–11), while `previousMonthISO` seeds the previous
 * month for the History tab. Two receipts carry
 * demo `image_url` placeholders (picsum) so the receipt-detail screen
 * shows a real ticket photo; real scans store the uploaded ticket URL.
 *
 * Mirrors the store list shape; `status` is 'confirmed' because the mock
 * save flow appends confirmed purchases.
 */
export const MOCK_RECEIPTS: {
  id: string;
  store_name: string;
  purchase_date: string;
  /** When the ticket was scanned (ISO). Orders "Recibos recientes" on Home. */
  scanned_at: string;
  total: number;
  image_url: string | null;
  status: PurchaseStatus;
  wants_snacks_total?: number;
  category_totals?: Record<string, number>;
  items?: {
    name: string;
    /** Line total (already existed; the feed consumes it). */
    amount: number;
    /**
     * Quantity and unit price are optional and only present when the
     * receipt participates in price alerts: the alert compares unit prices
     * of the same product identity across months, so without a unit price
     * there is no comparable price. When both exist, amount = quantity ×
     * unit_price (documented invariant).
     */
    quantity?: number;
    unit_price?: number;
    category: string;
  }[];
}[] = [
  {
    id: 'mock-receipt-0001',
    store_name: 'Supermercado Don Pedro',
    purchase_date: currentMonthDaysAgoISO(1),
    scanned_at: currentMonthDaysAgoISO(1),
    total: 12800.5,
    image_url: null,
    status: 'confirmed',
    // Matches the actual snack/impulse line item (Papas fritas x3, 3150).
    wants_snacks_total: 3150,
    category_totals: {
      lacteos: 2400,
      panaderia: 2100,
      snacks: 3150,
      refrescos: 2750.5,
      'frutas-verduras': 2400,
    },
    items: [
      { name: 'Leche entera 1L', amount: 1200, quantity: 1, unit_price: 1200, category: 'lacteos' },
      { name: 'Manteca 200g', amount: 1200, category: 'lacteos' },
      { name: 'Bizcochos de grasa x6', amount: 2100, category: 'panaderia' },
      { name: 'Papas fritas x3', amount: 3150, quantity: 3, unit_price: 1050, category: 'snacks' },
      { name: 'Gaseosa 2L', amount: 2750.5, category: 'refrescos' },
      { name: 'Bananas 1kg', amount: 1200, category: 'frutas-verduras' },
      { name: 'Tomates 1kg', amount: 1200, category: 'frutas-verduras' },
    ],
  },
  {
    id: 'mock-receipt-0002',
    store_name: 'Farmacity',
    purchase_date: currentMonthDaysAgoISO(2),
    scanned_at: currentMonthDaysAgoISO(2),
    total: 5420.3,
    image_url: null,
    status: 'confirmed',
    category_totals: {
      farmacia: 3200,
      higiene: 2220.3,
    },
    items: [
      { name: 'Ibuprofeno 600 x20', amount: 3200, category: 'farmacia' },
      { name: 'Shampoo 400ml', amount: 2220.3, category: 'higiene' },
    ],
  },
  {
    id: 'mock-receipt-0003',
    store_name: 'Starbucks',
    purchase_date: currentMonthDaysAgoISO(9),
    scanned_at: currentMonthDaysAgoISO(9),
    total: 3150,
    image_url: null,
    status: 'confirmed',
    wants_snacks_total: 3150,
    category_totals: {
      bebidas: 3150,
    },
    items: [{ name: 'Latte grande', amount: 3150, category: 'bebidas' }],
  },
  {
    id: 'mock-receipt-0004',
    store_name: 'Coto Hipermercado',
    purchase_date: currentMonthDaysAgoISO(5),
    scanned_at: currentMonthDaysAgoISO(5),
    total: 8975.1,
    image_url: null,
    status: 'confirmed',
    // No snack/impulse line items on this receipt.
    wants_snacks_total: 0,
    category_totals: {
      alimentos: 3200,
      carnes: 2600,
      lacteos: 1400,
      refrescos: 1775.1,
    },
    items: [
      { name: 'Arroz 1kg', amount: 1200, category: 'alimentos' },
      { name: 'Fideos 500g', amount: 900, category: 'alimentos' },
      { name: 'Yerba 1kg', amount: 1100, category: 'alimentos' },
      { name: 'Milanesas de pollo', amount: 1600, category: 'carnes' },
      { name: 'Carne picada', amount: 1000, category: 'carnes' },
      { name: 'Yogur entero', amount: 800, category: 'lacteos' },
      { name: 'Leche chocolatada', amount: 600, category: 'lacteos' },
      { name: 'Gaseosa cola 1.5L', amount: 1775.1, category: 'refrescos' },
    ],
  },
  {
    id: 'mock-receipt-0005',
    store_name: 'Panadería La Central',
    purchase_date: currentMonthDaysAgoISO(7),
    scanned_at: currentMonthDaysAgoISO(7),
    total: 2100.75,
    image_url: null,
    status: 'confirmed',
    category_totals: {
      panaderia: 2100.75,
    },
    // Mirrors the user's example: within Panadería, separate the daily
    // savory food from the sweet "ojitos" to see what to cut.
    items: [
      { name: 'Comida del día', amount: 1400, category: 'panaderia' },
      { name: 'Ojitos con crema x6', amount: 700.75, category: 'panaderia' },
    ],
  },
  {
    id: 'mock-receipt-0006',
    store_name: 'Librería El Ateneo',
    purchase_date: currentMonthDaysAgoISO(11),
    scanned_at: currentMonthDaysAgoISO(11),
    total: 4850,
    image_url: null,
    status: 'confirmed',
    category_totals: {
      otros: 4850,
    },
    items: [
      { name: 'Cuadernos x3', amount: 2400, category: 'otros' },
      { name: 'Novela', amount: 2450, category: 'otros' },
    ],
  },
  {
    id: 'mock-receipt-0007',
    store_name: 'Almacén Barrio Norte',
    purchase_date: currentMonthDaysAgoISO(4),
    // Scanned today (0 days ago) although bought 4 days ago: the demo that
    // "Recibos recientes" orders by scanned_at, not by purchase date — the
    // user scanned an older ticket first thing in the morning.
    scanned_at: currentMonthDaysAgoISO(0),
    total: 15600,
    // Demo placeholder photo so the receipt detail shows a real ticket
    // image; real scans store the uploaded ticket URL.
    image_url: 'https://picsum.photos/seed/ticketify-almacen/800/1200',
    status: 'confirmed',
    // Covers the user's real basket: comestibles, cleaning supplies,
    // paper goods, and water — so Limpieza/Alimentos/Bebidas/Higiene all
    // show grouped item rows in the drill-down.
    category_totals: {
      alimentos: 7300,
      limpieza: 4400,
      higiene: 1500,
      bebidas: 2400,
    },
    items: [
      { name: 'Arroz 1kg', amount: 1200, category: 'alimentos' },
      { name: 'Fideos 500g', amount: 900, category: 'alimentos' },
      { name: 'Caldo de verduras x6', amount: 500, category: 'alimentos' },
      { name: 'Salsa de tomate x2', amount: 700, category: 'alimentos' },
      { name: 'Fiambre (paleta cocida)', amount: 1100, category: 'alimentos' },
      { name: 'Pizzas congeladas x2', amount: 1600, category: 'alimentos' },
      // Second yerba purchase of the month (Coto has the 1kg): both
      // normalize to "yerba", so the item drill-down sums them across
      // stores and shows each ticket as a separate purchase row.
      { name: 'Yerba 500g', amount: 1300, category: 'alimentos' },
      { name: 'Detergente 750ml', amount: 800, category: 'limpieza' },
      { name: 'Suavizante 1L', amount: 1200, category: 'limpieza' },
      { name: 'Jabón líquido ropa 3L', amount: 2000, category: 'limpieza' },
      { name: 'Servilletas x2', amount: 400, category: 'limpieza' },
      { name: 'Papel higiénico x4', amount: 1500, category: 'higiene' },
      { name: 'Bidón de agua 12L', amount: 1500, category: 'bebidas' },
      { name: 'Agua con gas x6', amount: 900, category: 'bebidas' },
    ],
  },
  {
    id: 'mock-receipt-0008',
    store_name: 'Multiservicios del Barrio',
    purchase_date: currentMonthDaysAgoISO(3),
    scanned_at: currentMonthDaysAgoISO(3),
    total: 15900,
    // Demo placeholder photo; real scans store the uploaded ticket URL.
    image_url: 'https://picsum.photos/seed/ticketify-servicios/800/1200',
    status: 'confirmed',
    // Utility bills that sometimes come as ticket payments (Luz, Agua,
    // Teléfono) land in Servicios so they don't pollute food categories.
    category_totals: {
      servicios: 15900,
    },
    items: [
      { name: 'Luz (factura mensual)', amount: 8500, category: 'servicios' },
      { name: 'Agua (factura mensual)', amount: 3200, category: 'servicios' },
      { name: 'Teléfono (factura mensual)', amount: 4200, category: 'servicios' },
    ],
  },
  {
    // Lands reliably in the previous month via `previousMonthISO` (unlike a
    // fixed day offset, which spills two months back on the first days of a
    // month): guarantees the History tab has an older month to navigate to
    // while Home stays scoped to the current month, and keeps the
    // price-alert pair (Leche/Papas vs the current month) anchored. Totals
    // match the item rows (alimentos 3500 + limpieza 950 + bebidas 1500 +
    // lacteos 1100 + snacks 3060 = 10110).
    id: 'mock-receipt-0009',
    store_name: 'Mercado Central',
    purchase_date: previousMonthISO(),
    scanned_at: previousMonthISO(),
    total: 10110,
    image_url: null,
    status: 'confirmed',
    category_totals: {
      alimentos: 3500,
      limpieza: 950,
      bebidas: 1500,
      lacteos: 1100,
      snacks: 3060,
    },
    items: [
      { name: 'Harina 0000 1kg', amount: 900, category: 'alimentos' },
      { name: 'Azúcar 1kg', amount: 1100, category: 'alimentos' },
      { name: 'Aceite de girasol 1L', amount: 1500, category: 'alimentos' },
      { name: 'Detergente lavaplatos', amount: 950, category: 'limpieza' },
      { name: 'Agua mineral 2L x6', amount: 1500, category: 'bebidas' },
      // Price-alert pairs with the current month (0001): Leche entera 1L
      // was 1100 last month vs 1200 now (+9.1% → alert); Papas fritas x3
      // was 1020/unit last month vs 1050/unit now (+2.9% → below the 5%
      // threshold, no alert).
      { name: 'Leche entera 1L', amount: 1100, quantity: 1, unit_price: 1100, category: 'lacteos' },
      { name: 'Papas fritas x3', amount: 3060, quantity: 3, unit_price: 1020, category: 'snacks' },
    ],
  },
];
