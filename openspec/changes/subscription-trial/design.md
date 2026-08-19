# Design: Subscription Trial

## Technical Approach

Extend the binary Pro/Free model to a 4-state subscription lifecycle (`none → trial → active/expired → active`) using DB-authoritative state with RevenueCat webhook sync. The existing `tier` column stays as the access-control primitive (`free`/`pro`); a new `subscription_status` column tracks the business lifecycle. A new `start_free_trial()` RPC activates trials. The client gate gains a `'frozen'` state for expired trials (reads work, writes blocked).

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Trial source of truth | DB RPC vs RevenueCat-only | RC-only couples trial logic to SDK availability; DB RPC is offline-safe and testable | **DB RPC** (`start_free_trial`) — RC webhooks sync async |
| Column design | Separate `subscription_status` vs extend `tier` CHECK | Extending `tier` breaks `set_profile_tier` contract + RLS patterns | **Separate column** — `tier` stays binary, `subscription_status` owns lifecycle |
| Frozen state | Client-only timer vs DB poll | Client timer works offline but drifts; DB poll is authoritative | **Hybrid** — client-side `trial_ends_at` check on launch + DB refresh |
| Gate expansion | 3-state `GateState` vs separate `FrozenGuard` | Separate guard duplicates route-guard logic | **Expand `GateState`** to `'locked' | 'unlocked' | 'frozen'` |

## State Machine

```
none ──[start trial]──→ trial ──[5 days]──→ expired
  │                        │                     │
  │                        └──[purchase]──→ active└──[purchase]──→ active
  └──[purchase]──→ active
```

DB mapping:
- `subscription_status`: `none | trial | expired | active`
- `tier`: `free` (none/trial/expired while trial, free) | `pro` (trial, active)
- `trial_ends_at`: timestamp (set on trial start, NULL otherwise)

**Critical invariant**: `tier = 'pro'` ⟺ (`subscription_status = 'active'` OR (`subscription_status = 'trial'` AND `trial_ends_at > now()`)).

## Data Flow

```
Client                    DB                         RevenueCat
  │                         │                           │
  ├─ start_free_trial() ───→│ subscription_status=trial │
  │                         │ tier=pro                  │
  │                         │ trial_ends_at=now()+5d    │
  │←─ subscription row ─────┤                           │
  │                         │                           │
  │  [5 days pass / webhook]│←── TRIAL_ENDED event ─────┤
  │                         │ subscription_status=expired│
  │                         │ tier=free                 │
  │←─ refresh() ────────────┤                           │
  │  gate → frozen          │                           │
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/0016_trial_subscription.sql` | Create | Schema + RPCs (§1–§4) |
| `src/types/index.ts` | Modify | Add `SubscriptionStatus`, extend `User` with `subscription_status`, `trial_ends_at` |
| `src/stores/use-pro-store.ts` | Modify | Add `subscriptionStatus`, `trialEndsAt`, `isTrialing` fields |
| `src/features/pro/gate.ts` | Modify | Expand `GateState` to 3 states; `resolveGateState` takes subscription args |
| `src/features/pro/hooks/useProEntitlement.ts` | Modify | Expose trial state to consumers |
| `src/features/pro/ProRouteGuard.tsx` | Modify | Handle `'frozen'` — render children (reads work) but wrap with FrozenGuard |
| `src/features/pro/components/FrozenGuard.tsx` | Create | Overlay component: disables writes, shows frozen messaging |
| `src/features/pro/components/TrialBanner.tsx` | Create | Countdown banner for active trials |
| `src/app/pro/index.tsx` | Modify | Add "Start free trial" CTA above purchase buttons |
| `src/lib/revenuecat.ts` | Modify | Add trial package lookup |
| `src/features/pro/pro-bootstrap.tsx` | Modify | Fetch `subscription_status` + `trial_ends_at` from DB on bootstrap |
| `src/lib/supabase/feature-access.ts` | Modify | Add `readSubscriptionState`, `startFreeTrial` |
| `src/app/(tabs)/profile.tsx` | Modify | Trial status display, frozen overlay on write rows |
| `supabase/migrations/0014_household_sharing.sql` | Modify | `join_household` removes Pro tier check |

## Database Design (0016)

**§1 — Schema**: Add `subscription_status` (text, default `'none'`, CHECK in `none|trial|active|expired`) and `trial_ends_at` (timestamptz, nullable) to `profiles`.

**§2 — start_free_trial()**: SECURITY DEFINER owned by postgres. Validates: no existing trial (`trial_ends_at IS NULL`), no active sub (`subscription_status != 'active'`). Sets `subscription_status = 'trial'`, `trial_ends_at = now() + interval '5 days'`, `tier = 'pro'`. Normalizes scan_usage to Pro (NULL scans_limit).

**§3 — set_profile_tier update**: Extend to accept `p_tier = 'pro'` AND set `subscription_status = 'active'`, `trial_ends_at = null` (RevenueCat webhook path: trial→active on purchase). Extend `p_tier = 'free'` to also set `subscription_status = 'expired'` when current status is `'trial'`.

**§4 — protect_profile_tier update**: Extend trigger to also guard `subscription_status` and `trial_ends_at` — only the SECURITY DEFINER path (`current_user = 'postgres'`) may write these columns.

## Household Integration

| RPC | Current Check | New Check | Rationale |
|-----|--------------|-----------|-----------|
| `create_household` | `tier = 'pro'` | `tier = 'pro'` OR `subscription_status = 'trial'` | Owner needs Pro access (trial qualifies) |
| `generate_invite_code` | `tier = 'pro'` | Unchanged (owner already checked at create) | Owner already validated |
| `join_household` | `tier = 'pro'` | **Remove check** | Members participate free per proposal |
| `leave_household` | None | None | No change |
| `disband_household` | Owner check | None | Owner check sufficient |

## Offline Handling

- **App launch/foreground**: Client reads `trial_ends_at` from local profile cache. If `now() > trial_ends_at` and `subscriptionStatus === 'trial'`, immediately set gate to `'frozen'` without waiting for DB.
- **During offline**: If trial expires while offline, the gate flips to `'frozen'` based on client-side clock. Next online refresh syncs DB state (`subscription_status = 'expired'`).
- **Clock skew defense**: `start_free_trial()` server uses `now()` — client cannot manipulate trial length. Client-side expiry is a UX optimization, not a security boundary.

## Interfaces

```typescript
// types/index.ts
export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'expired';

export interface User {
  // ...existing fields...
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
}

// stores/use-pro-store.ts
export interface ProState {
  isPro: boolean;
  isLoading: boolean;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  refresh: () => Promise<void>;
  setPro: (isPro: boolean) => void;
}

// features/pro/gate.ts
export type GateState = 'locked' | 'unlocked' | 'frozen';
```

## Migration / Rollout

1. Migration 0016: additive columns + RPCs. Existing Pro users get `subscription_status = 'active'` (backfill). Free users get `subscription_status = 'none'`.
2. Client ships with new gate logic. Gate is backward-compatible: `resolveGateState` defaults `'frozen'` to `'locked'` when `subscriptionStatus` is missing (pre-migration profiles).
3. No feature flag needed — trial is opt-in (user must tap CTA).

## Open Questions

- [ ] Should `start_free_trial` call RevenueCat's `Purchases.syncPurchases()` or is the DB update sufficient until the next natural sync?
- [ ] RevenueCat webhook mapping: confirm exact event type strings for TRIAL_STARTED / TRIAL_ENDED (may vary by SDK version).
- [ ] Should the FrozenGuard overlay also appear on the profile screen's settings rows, or only on feature-level write guards?
