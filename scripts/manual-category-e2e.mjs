#!/usr/bin/env node
/**
 * Manual end-to-end checklist for the custom-category lifecycle +
 * budgets/rollover (change `category-management` — PR 7 of 7, final).
 *
 * Deliberately NOT part of `pnpm test` (the test chain is an explicit list of
 * `test:*` scripts; this file is not one of them). It verifies the full
 * cross-feature flow on a REAL device/simulator with a signed-in user — needs
 * the local dev backend (supabase + storage) running and at least one ticket
 * purchase item to re-assign.
 *
 *   pnpm manual:category-e2e
 *
 * This script only prints the checklist and waits for your answers. It makes
 * zero network/app calls. The automated guarantees (merge order, rollover
 * validKeys, sentinel, delete-on-zero, fail-closed catalog gate) live in the
 * suite: test-categories.mjs, test-category-budget-progress.mjs,
 * test-category-budget-rollover.mjs, test-budget-month-local.mjs.
 */

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function step(number, title, { do: action, expect }) {
  console.log(`\n=== Step ${number}: ${title} ===`);
  console.log(`  DO:  ${action}`);
  console.log(`  OK:  ${expect}`);
  const answer = await ask('       [press enter when verified] ');
  if (answer.trim().toLowerCase() === 'n') {
    console.log('  !!! Marked as NOT verified.');
    process.exitCode = 1; // non-zero only on explicit "n"
  }
}

async function main() {
  console.log('==============================================================');
  console.log(' MANUAL E2E — custom category lifecycle + budgets/rollover');
  console.log(' PR 7 of 7 (category-management, final)');
  console.log('==============================================================');
  console.log(`
  Prerequisites: dev supabase + storage + API running; simulator/device
  signed in with a normal (non-frozen) user; at least one ticket with
  purchase items available to re-assign. Set the device month to a fresh
  month if you want to observe a backend rollover (or reset month data).

  Expected end state: custom category created, items assigned, budget set,
  month rollover carried it forward, delete blocked while items remain,
  then items re-assigned to a canonical category and the custom one
  deleted.`);

  await step(1, 'Create a custom category', {
    do: 'Profile → Categories (or the picker) → "Nueva categoría" → name '
      + '"Delivery", pick a color → save.',
    expect: 'The new row appears in the picker list with its own label + '
      + 'color, NOT bucketed as "Otros" (mergeCategoryCatalog + '
      + 'resolveCategoryDisplay own-row convergence).',
  });

  await step(2, 'Assign items to it', {
    do: 'Edit a recent ticket receipt → re-assign one purchase item to '
      + '"Delivery" → save.',
    expect: 'The receipt re-renders with the Delivery label/color on that '
      + 'item; Home feed shows the Delivery row with its spend.',
  });

  await step(3, 'Set a budget for it', {
    do: 'Profile → "Presupuestos por categoría" → enter an amount in the '
      + 'Delivery row (custom rows now list alongside the 13 canonical) '
      + '→ Guardar.',
    expect: 'Delivery row appears with its OWN name/color; after save, '
      + 'Analytics monthly totals for Delivery show budget_limit = the '
      + 'entered amount (mergeBudgetLimits keyed by the catalog slug).',
  });

  await step(4, 'Rollover carries it forward (catalog-aware validKeys)', {
    do: 'With the next month still empty of budgets, open Analytics (or '
      + 'any consumer of useCategoryBudgets) for that next month.',
    expect: 'The Delivery budget limit was copied to the new month '
      + 'EXACTLY like the canonical ones — the rollover validKeys now come '
      + 'from the dynamic merged catalog, not the static 13 (spec: custom '
      + 'categories roll over; the __rollover__ sentinel still writes).',
  });

  await step(5, 'Delete is blocked while items reference the category', {
    do: 'Profile → Categories → try to delete "Delivery" while its '
      + 'purchase item still exists.',
    expect: 'The delete fails closed with the user-safe copy (count > 0 → '
      + 'blocked) — no partial deletion, no data loss.',
  });

  await step(6, 'Reassign then delete', {
    do: 'Edit the receipt again → re-assign the item from "Delivery" to a '
      + 'canonical category (e.g. Alimentos) → save → now delete "Delivery".',
    expect: 'Delete succeeds; catalogs, feeds, analytics totals, monthly '
      + 'cache and receipts all refetch; the Delivery rows vanish '
      + 'everywhere. On the NEXT rollover, a stale Delivery budget row '
      + '(if any) is dropped — the slug is gone from the catalog.',
  });

  await step(7, 'Budget screen still saves/clears canonically', {
    do: 'Budget screen: set an amount on Alimentos → Guardar; then clear it '
      + '→ Guardar again.',
    expect: 'Set → row persists (upsert). Clear → row deleted '
      + '(delete-on-zero); the __rollover__ sentinel survives so a fresh '
      + 'month does not re-copy stale values.',
  });

  console.log('\n==============================================================');
  if (process.exitCode !== 0) {
    // S-1 (PR 7 re-gate): an explicit "n" set exitCode = 1 — the banner must
    // not contradict the failure with an "OK" sign-off.
    console.log(' MANUAL E2E COMPLETE — ISSUES FOUND (see "NOT verified" steps above)');
  } else {
    console.log(' MANUAL E2E COMPLETE — custom category + budgets/rollover OK');
  }
  console.log(' Automated guarantees: see test-categories.mjs,');
  console.log(' test-category-budget-progress.mjs, test-category-budget-rollover.mjs,');
  console.log(' test-budget-month-local.mjs');
  console.log('==============================================================');
  rl.close();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());