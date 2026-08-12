# Tasks: Pro Subscription (RevenueCat)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,400–1,800 (server migrations ~300, webhook edge ~350, parse-ticket ~120, client gate infra ~400, charts ~250, meters ~150, price-alert ~80, D3 ~10, tests + SQL smoke ~250) |
| 400-line budget risk | High — every individual work unit is small (≤400), but the cumulative diff is ~1,500 lines; orchestrator-cached budget is 800 lines |
| Chained PRs recommended | Yes |
| Suggested split | M1 migrations → M2 webhook → M3 parse-ticket → M4 client gates → M5 meters → M6 charts → M7 price-alert → M8 tests. D3 isolated (parallel, any slot) |
| Delivery strategy | auto-forecast |
| Chain strategy | pending — see Decision |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units (chained PRs)

| Unit | Goal | Base branch | Notes |
|------|------|-------------|-------|
| WU-D3 | Remove dead settings-store `tier` field (D3, REQ-PROF-3) | main | Isolated, depends on nothing; can land first or last |
| WU-M1.1 | Migration 0011 (nullable limit + backfill 15 + tier-driven `try_consume_scan` + atomic `set_profile_tier` + D1 trigger + owner→postgres) | main | Foundation; precedes webhook call |
| WU-M1.2 | Migration 0012 (`webhook_events` ledger) | main | Depends on M1.1 (webhook references 0011 RPCs) |
| WU-M2.1 | Webhook skeleton + `config.toml` (`verify_jwt=false`) + `lib/{event-types,uuid}` | main | Skeleton before auth/ledger wiring |
| WU-M2.2 | `lib/verify.ts` constant-time SHA-256 digest loop (WARNING-3) | main | Foundation for M2.4 |
| WU-M2.3 | Webhook ledger insert + ordering check (WARNING-1, REQ-SYNC-6) | main | Depends on M1.2 + M2.1 |
| WU-M2.4 | Webhook `set_profile_tier` wiring + missing-profile 200 no-op (WARNING-2) | main | Depends on M2.2 + M2.3 |
| WU-M3 | parse-ticket: `SCANS_LIMIT=15` + pre-check NULL branch removed + `quota_exceeded_pre` vs `quota_exceeded_race` envelopes | main | Depends on M1.1 (RPC semantics) |
| WU-M4.1 | `lib/revenuecat.ts` + `use-pro-store` + `useProEntitlement` + `gate.ts` (`resolveGateState`) | main | Pure infra, no UI mount yet |
| WU-M4.2 | `pro-bootstrap.tsx` + mount in `_layout.tsx` + register `/pro/index` + `/pro/charts` (latter wrapped in `ProRouteGuard`) | main | Depends on M4.1 |
| WU-M5 | Quota meters: `quota.ts` `computeQuotaState` + `useScanQuota` returns `isPro` + `ScanQuotaCard` + `UsageMeter` + `UsageLimitsCard` with `isPro` (CRITICAL-2, REQ-QUOTA-6) | main | Depends on M4.1 (reads `useProEntitlement`) |
| WU-M6.1 | Worklets/skia version spike (FIRST, isolated; result gate) | main | Decoupled from chart code; lands alone |
| WU-M6.2 | Charts deps (`react-native-purchases`, victory-native XL 41.x, skia ≥2.2.7, pinned worklets) + `app.json` plugin check | main | Depends on M6.1 result |
| WU-M6.3 | Charts screen + aggregators + components + entry card in analytics.tsx | main | Depends on M6.2 |
| WU-M7 | `PriceAlert.receiptId` S2 deterministic rule + types + hook + analytics banner navigates `/receipts/:receiptId` (REQ-GATE-2) | main | Independent of M2–M6 |
| WU-M8.1 | Unit harnesses: `test-pro-gating`, `test-quota-tier`, `test-charts`, `test-webhook-idempotency`, `test-verify-constant-time` + tsconfigs | main | Pure modules from WUs above |
| WU-M8.2 | `test-profile-hook.mjs` `resetAll` drops `tier` key (D3 regression) | main | Depends on WU-D3 |
| WU-M8.3 | `supabase/tests/pro-subscription.sql` (WARNING-7 paths) + package.json test script wiring | main | Depends on M1.1 + M1.2 |

## Phase 1: Migrations (M1)

- [x] 1.1 **`0011_pro_scan_quota_and_tier.sql`** — alter `scan_usage.scans_limit` drop NOT NULL + default 15 + backfill to 15; rewrite `try_consume_scan` as tier-driven (tier SELECT + `INSERT … case when v_tier='pro' then null else 15 end` + guarded UPDATE `v_tier='pro' or su.scans_used < coalesce(su.scans_limit, 15)`); recreate `set_profile_tier` as atomic (profiles.tier + current+future months scan_usage `scans_limit`) SECURITY DEFINER owned by postgres; revoke PUBLIC execute, grant to service_role; replace trigger body to allow when `current_user='postgres'` (D1). Acceptance: `supabase db reset` runs clean; `protect_profile_tier` trigger fires; `set_profile_tier` writes both columns atomically. Rollback: drop function bodies, restore NOT NULL.
- [x] 1.2 **`0012_webhook_events.sql`** — create `public.webhook_events(user_id uuid FK, event_id text, event_ts timestamptz, event_type text, applied_at timestamptz default now())` PK `(user_id, event_id)` + index `(user_id, event_ts desc)` + comment. Acceptance: `supabase db diff` shows ledger only. Rollback: drop table.

## Phase 2: Webhook Edge Function (M2)

- [x] 2.1 **Skeleton + `config.toml`** — `supabase/functions/revenuecat-webhook/{index.ts, lib/event-types.ts, lib/uuid.ts}`; config.toml `[functions.revenuecat-webhook] verify_jwt=false`; GRANT/REVOKE sets in `event-types.ts`; UUID v4 regex in `lib/uuid.ts`. Acceptance: function deploys; Deno type-check clean.
- [x] 2.2 **`lib/verify.ts`** — SHA-256 digest both sides, fixed 32-byte byte loop non-short-circuiting; identical 401 for missing/wrong/empty/length-mismatch, no DB touch. Acceptance: WARNING-3 contract; later unit-tested in 8.1.
- [x] 2.3 **Ledger insert + ordering check** — `INSERT INTO webhook_events … ON CONFLICT DO NOTHING RETURNING applied_at`; no row → 200 no-op (REQ-SYNC-6); `SELECT max(event_ts) WHERE user_id=…`; new `event_ts < last_ts` → 200 no-op (WARNING-1). Acceptance: dedupe + ordering semantics.
- [x] 2.4 **`set_profile_tier` wiring + missing-profile no-op** — GRANT/REVOKE → `svc.rpc('set_profile_tier', …)`; catch RPC `profile not found` (P0002 + message) → 200 no-op (WARNING-2). Acceptance: integration with 0011 RPC; never 500 on never-signed-in REVOKE.

## Phase 3: parse-ticket (M3)

- [x] 3.1 **Quota sequencing rewrite** — `SCANS_LIMIT=15` (line 478); remove pre-check NULL branch (numeric `used >= limit` only); call Gemini BEFORE consume (D2); on RPC `ok=false` → 429 `quota_exceeded_race` with `{limit, used, raceLost:true}`; failed parse → 422, no consume (REQ-QUOTA-4). Acceptance: pre-check `quota_exceeded_pre` (no Gemini) vs post-parse `quota_exceeded_race` distinct envelopes.

## Phase 4: Client Gate Infrastructure (M4)

- [x] 4.1 **Pure infra** — `src/lib/revenuecat.ts` (configure wrapper returning `false` in Expo Go; customerInfo fetch; purchase/restore wrapped try/catch; listener fail-open); `src/stores/use-pro-store.ts` `{isPro,isLoading}` (initial `isLoading=true`); `src/features/pro/hooks/useProEntitlement.ts` (store + `refresh`); `src/features/pro/gate.ts` `resolveGateState(isPro,isLoading): 'locked'|'unlocked'` with `isLoading→locked` (REQ-GATE-5).
- [x] 4.2 **Bootstrap + routes** — `src/features/pro/pro-bootstrap.tsx` (module-level `configured` guard, session-watched `configure`, listener → store); `src/features/pro/ProRouteGuard.tsx` (free → `<ProLock/>`, pro → children); `src/features/pro/components/ProLock.tsx` (CTA → `/pro`); mount `pro-bootstrap` inside `QueryClientProvider` in `_layout.tsx:101`; register `Stack.Screen name="pro/index"` (session-gated only) and `Stack.Screen name="pro/charts"` wrapped in `<ProRouteGuard>`; `src/app/pro/index.tsx` (paywall: offerings, purchase, restore, error/success states).

## Phase 5: Quota Meters Wiring (M5)

- [x] 5.1 **Pure + types** — `src/features/home/quota.ts` `computeQuotaState(used, limit:number|null, isPro)` with `unlimited|remaining|exhausted|ratio|showUpgradeCta`; `isPro` short-circuits to unlimited (CRITICAL-2); `coalesce(limit,15)` mirror; `src/types/index.ts` widens `ScanUsage.scans_limit:number|null` (line 114).
- [x] 5.2 **Hooks + components** — `useScanQuota` returns `{usage, isPro}` (reads `useProEntitlement`); `ScanQuotaCard` accepts `isPro`, renders "Ilimitado" + no CTA when `unlimited`, "Sin escaneos disponibles" + paywall CTA only when `!isPro && exhausted`; `UsageMeter` accepts `limit:number|null` + `isPro`, hides upgrade pitch when `isPro`; `UsageLimitsCard` pass-through with `isPro` from profile screen (`profile.tsx:18` → `useProfile` returns `isPro` joining pro entitlement).

## Phase 6: Charts Entry + Guard (M6)

- [x] 6.1 **Worklets/skia spike (FIRST, isolated)** — tried `worklets@0.5.1` + `skia@2.2.12` via `npx expo install` (SDK 54 defaults), escalated to `worklets@0.8.0` + `skia@2.11.0` after scanning peer deps (worklets ≥0.9 needs RN ≥0.83; reanimated 4.5 needs worklets 0.10+ + RN 0.83+). Compat matrix verified: worklets 0.8.0 ↔ RN 0.81-0.85 ✓, reanimated 4.1.7 ↔ worklets 0.5-0.8 ✓, skia 2.11.0 ↔ worklets ≥0.7.0 + reanimated ≥4.0.0 ✓. No peer-dep conflicts. Result documented in `SPIKE-RESULT.md`.
- [x] 6.2 **Deps + plugin** — `package.json` add `victory-native@^41.26.0` (resolved 41.26.0; skia 2.11.0 / worklets 0.8.3 / reanimated 4.1.7 / purchases 9.15.2 already in place from M6.1 + M4); `app.json` plugins array unchanged — purchases has no Expo config plugin, just needs dev-client rebuild; `babel.config.js` not needed — `babel-preset-expo@54.0.12` auto-injects `react-native-worklets/plugin` when worklets is installed. Result documented in `M6.2-RESULT.md`.
- [ ] 6.3 **Charts code (depends on 6.2 result)** — `src/features/charts/aggregate.ts` (`aggregateSpendTrend` zero-fill + N-month window; `aggregateStoresByMonth` deterministic order; donut reuses `aggregateCategoriesByMonth`); `src/features/charts/components/{TrendChart,CategoryDonut,StoreBars}.tsx` (skia + victory-native XL); `src/app/pro/charts.tsx` body wrapped in `<ProRouteGuard>`; charts entry card under `MonthlyOverviewCard` in `analytics.tsx:152-156` (free → lock + `router.push('/pro')`; pro → `/pro/charts`).

## Phase 7: Price-Alert receiptId (M7)

- [ ] 7.1 **receiptId capture (S2 deterministic)** — `src/types/index.ts` add `PriceAlert.receiptId:string`; `src/features/analytics/price-alerts.ts` capture first receipt per `(identity, currentMonthKey())` tuple under `records` order with tie-break `id` ascending; `src/features/analytics/hooks/usePriceAlerts.ts` pass-through; `src/app/(tabs)/analytics.tsx:157-179` banner renders `<Pressable onPress={() => router.push(\`/receipts/\${alert.receiptId}\`)}>` for pro; free path uses `<ProLock/>` overlay (REQ-GATE-2). Acceptance: two runs on same data produce identical `receiptId` (S2 stable ordering).

## Phase 8: Tests + SQL Smoke (M8)

- [ ] 8.1 **Pure unit harnesses** — `scripts/test-pro-gating.mjs` (`resolveGateState` truth table); `scripts/test-quota-tier.mjs` (`computeQuotaState` pro/numeric/null/exhausted); `scripts/test-charts.mjs` (trend zero-fill, store-bar determinism, donut parity vs `aggregateCategoriesByMonth`); `scripts/test-webhook-idempotency.mjs` (UUID validation, ledger dedupe, ordering simulation); `scripts/test-verify-constant-time.mjs` (correct/wrong/empty/length-mismatch); harness tsconfigs `tsconfig.{pro-gating,charts,quota-tier,webhook-idempotency,verify-constant-time}-test.json`.
- [ ] 8.2 **profile-hook regression** — `scripts/test-profile-hook.mjs` `resetAll` (line 212-222) drops the removed `tier` key; assert no consumer references store `tier` (D3 verification).
- [ ] 8.3 **SQL smoke (WARNING-7)** — `supabase/tests/pro-subscription.sql` runs against scratch DB (`supabase db test` or pgTAP): grant→NULL, revoke→15, free 15/15 → 429, pro → unlimited, race at 14/15 → single winner, out-of-order event skipped (W2), `authenticated` cannot execute `set_profile_tier`, raw `service_role` UPDATE rejected by `protect_profile_tier` (SUGGESTION-1). Wire into `package.json:test` chain.

## Phase 9: Settings-Store Cleanup (D3, isolated, parallel)

- [ ] 9.1 **Remove dead `tier`** — `src/stores/use-settings-store.ts` remove `tier`, `setTier`, `ScanTier` import (D3); `src/types/index.ts:45` keeps `ScanTier` for `ProfileHeader` (read-only consumer). Depends on nothing; rollback is a single file revert.

## Traceability Summary

| REQ | Work Unit |
|-----|-----------|
| REQ-PRO-1..5 | WU-M4.1, WU-M4.2 |
| REQ-GATE-1 | WU-M6.3 (charts entry card) + WU-7.1 (banner lock) — REQ-GATE-1 export row: profile.tsx wiring within WU-M6.3 if charts entry card lands there; export row gets its own gate call in profile settings |
| REQ-GATE-2 | WU-M7.1 |
| REQ-GATE-3 | WU-M6.3 + WU-M4.2 (ProRouteGuard) |
| REQ-GATE-4 | WU-M5.1, WU-M5.2 |
| REQ-GATE-5 | WU-M4.1 (gate.ts), WU-M4.2 |
| REQ-CHART-1..6 | WU-M6.1, WU-M6.2, WU-M6.3 |
| REQ-QUOTA-1..7 | WU-M1.1, WU-M3.1, WU-M5.1, WU-M5.2, WU-M8.1, WU-M8.3 |
| REQ-SYNC-1..7 | WU-M1.1, WU-M2.1, WU-M2.2, WU-M2.3, WU-M2.4, WU-M8.1, WU-M8.3 |
| REQ-PROF-1..3 | WU-D3, WU-M1.1, WU-M8.2, WU-M8.3 |

## Open Decisions

- **Chain strategy (pending)**: orchestrator must ask before apply (single PR over 800-line budget). Two viable paths: **stacked-to-main** (each WU merges to main in order; fastest, independent slices) vs **feature-branch-chain** (tracker branch accumulates integration, only tracker merges to main; better rollback control). Recommended: stacked-to-main because work units are independently verifiable and most touch disjoint files.
- **Worklets/skia spike result** (WU-M6.1) gates WU-M6.2 — no chart code may import skia until the spike commits a pinned version.

## Skills Used

- `sdd-tasks` (this artifact)
- `work-unit-commits` (each WU = one commit/PR with tests+docs)
- `chained-pr` (review budget guard; WUs above are stackable work units)
