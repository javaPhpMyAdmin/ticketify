# M6.1 Worklets/Skia Spike — Result

**Date**: 2026-08-12
**Change**: pro-subscription (WU-M6.1)
**Branch**: sdd/pro-subscription-m6
**Base**: 3837402 (squash of #37)

## Goal

Probe which versions of `react-native-worklets`, `@shopify/react-native-skia`, and
`react-native-reanimated` are mutually compatible with the installed Expo SDK 54 and
React Native 0.81.0 stack, so M6.2 can pin exact versions and M6.3 can import skia
without runtime surprises.

This is a dep-only spike. No chart code, no screen changes, no `app.json` plugin changes.

## Environment

| Field | Value |
|-------|-------|
| Expo SDK | 54.0.36 |
| React Native | 0.81.0 |
| React | 19.1.0 |
| Node package manager | pnpm 9.15.9 |
| pre-existing `react-native-purchases` | ^9.0.0 (M4 batch declared; never locked) |

## Step 1 — `npx expo install` (SDK-compatible defaults)

```
> pnpm add react-native-worklets@0.5.1 @shopify/react-native-skia@2.2.12
```

| Package | Resolved | Design target | Status |
|---------|----------|---------------|--------|
| `react-native-worklets` | 0.5.1 | ≥ 0.7.0 | **BELOW** target |
| `@shopify/react-native-skia` | 2.2.12 | ≥ 2.2.7 | OK |
| `react-native-reanimated` | 4.1.7 (pre-existing) | — | OK |

`expo install` picked the SDK 54 pinned line (worklets 0.5.x, skia 2.2.x). The 0.5.x
worklets line is **below** the design target of ≥ 0.7.0. Per the spike contract, we
escalate to the highest compatible combination.

> Note: the orchestrator prompt expected `expo install` to resolve worklets to 0.6.0.
> The actual SDK 54 pinned version is 0.5.1 (a downgrade from the pre-existing 0.5.2
> declaration). Either way, both are below the design target, so we escalated.

## Step 2 — Compat matrix scan

We searched npm for the highest `react-native-worklets` version that supports
`react-native@0.81.0` and is compatible with the already-pinned
`react-native-reanimated@4.1.7`.

| Package | Peer constraint (relevant fields) | Compatible with our stack? |
|---------|-----------------------------------|----------------------------|
| `react-native-worklets@0.5.x` | `react-native: *` | ✓ but below design target |
| `react-native-worklets@0.6.x` | `react-native: *` | ✓ but below design target |
| `react-native-worklets@0.7.x` | `react-native: *` | ✓ meets design target |
| `react-native-worklets@0.8.0` | `react-native: 0.81 - 0.85` | ✓ **ceiling for our stack** |
| `react-native-worklets@0.9.0+` | `react-native: ≥ 0.83` | ✗ requires RN upgrade |
| `react-native-worklets@0.12.0` | `react-native: 0.83 - 0.87` | ✗ |
| `react-native-reanimated@4.1.7` | `react-native-worklets: 0.5 - 0.8` | ✓ ceiling = 0.8.x |
| `@shopify/react-native-skia@2.10.x` | `worklets ≥ 0.7.0`, `reanimated ≥ 4.0.0`, `RN ≥ 0.78` | ✓ |
| `@shopify/react-native-skia@2.11.0` | `worklets ≥ 0.7.0`, `reanimated ≥ 4.0.0`, `RN ≥ 0.78` | ✓ latest stable |
| `@shopify/react-native-skia@2.12.0-next.1` | `worklets ≥ 0.7.0`, `reanimated ≥ 4.0.0` | ✓ but pre-release |

**Constraint chain**: RN 0.81.0 → caps worklets at 0.8.x → caps reanimated at 4.1.x
(reanimated 4.5+ requires worklets 0.10+ and RN 0.83+). Upgrading any of these would
cascade a React Native bump, which is out of scope for M6.

## Step 3 — Escalation install

```
> pnpm add react-native-worklets@0.8.0 @shopify/react-native-skia@2.11.0
```

Final resolved versions after escalation:

| Package | Resolved | In package.json | Design target | Status |
|---------|----------|------------------|---------------|--------|
| `react-native-worklets` | 0.8.0 | `~0.8.0` | ≥ 0.7.0 | ✓ ABOVE target |
| `@shopify/react-native-skia` | 2.11.0 | `2.11.0` | ≥ 2.2.7 | ✓ ABOVE target |
| `react-native-reanimated` | 4.1.7 | `~4.1.0` | (unchanged) | ✓ |
| `react-native-purchases` | 9.15.2 | `^9.0.0` | (M6.2 scope) | ✓ now locked |

## Compat check (final)

- `react-native-worklets@0.8.0` peerDeps: `react-native: 0.81 - 0.85` → RN 0.81.0 ✓
- `react-native-worklets@0.8.0` peerDeps: `@babel/core: *` → @babel/core 7.29.7 ✓
- `react-native-reanimated@4.1.7` peerDeps: `react-native-worklets: 0.5 - 0.8` → 0.8.0 ✓
- `@shopify/react-native-skia@2.11.0` peerDeps: `react-native-worklets ≥ 0.7.0` → 0.8.0 ✓
- `@shopify/react-native-skia@2.11.0` peerDeps: `react-native-reanimated ≥ 4.0.0` → 4.1.7 ✓
- `@shopify/react-native-skia@2.11.0` peerDeps: `react-native ≥ 0.78` → 0.81.0 ✓
- `@shopify/react-native-skia@2.11.0` peerDeps: `react ≥ 19.0` → 19.1.0 ✓

All four native modules agree on RN 0.81.0 and React 19.1.0. **No warnings, no peer
dep conflicts.**

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Tests | `pnpm test` | ✓ 298 tests passing (17 + 14 + 57 + 28 + 102 + 15 + 11 + 6 + 10 + 20 + 7 + 11) |
| Typecheck | `pnpm typecheck` | ✓ clean (no output = no errors) |
| Lint | `pnpm lint` | ✓ 0 errors, 7 pre-existing warnings (no spike files affected) |
| `pnpm-lock.yaml` integrity | `grep` for `react-native-purchases` | ✓ now locked at 9.15.2 (was orphaned in package.json before spike) |

No chart code, screen, or `app.json` plugin changes were made. The spike is purely
`package.json` + `pnpm-lock.yaml` (which also locks the previously-unlocked
`react-native-purchases@9.15.2` as a side-effect).

## Recommendation for M6.2

**Proceed with:**

```json
"react-native-worklets": "~0.8.0",
"@shopify/react-native-skia": "2.11.0",
"react-native-reanimated": "~4.1.0"
```

These are pinned to the highest combination that:
1. Meets the design's `worklets ≥ 0.7.0` and `skia ≥ 2.2.7` targets.
2. Stays within React Native 0.81.0 (no forced RN bump).
3. Resolves cleanly with the already-pinned reanimated 4.1.x.
4. Passes the test, typecheck, and lint gates.

**Open in M6.2** (out of scope for M6.1):
- Add `victory-native` (the chart UI library) and verify its skia peer.
- Confirm the RevenueCat SDK plugin requirement for `app.json` (per the orchestrator's
  M6.2 spec note: "verify `app.json` plugin requirement for purchases").
- Dev-client rebuild (user-driven; the spike does not touch native projects).

**Unchanged from M4 batch**: `react-native-purchases` declaration was present in
package.json at `^9.0.0` but was not previously locked. The spike's `pnpm add` ran a
full lockfile resolution, so it is now pinned at `9.15.2`. No behavior change — just
coherent lockfile state entering M6.2.

## Rollback

`git revert <m6.1-sha>` removes the two package.json entries and restores the
pre-spike lockfile. No consumer code is touched, so revert is safe.