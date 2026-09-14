/**
 * Pure form helpers for the category-budget settings screen (change
 * `category-management` PR 7: the budgets screen consumes the MERGED catalog
 * — 13 canonical ∪ the caller's own custom rows — exactly like the rollover
 * key set, D3).
 *
 * Zero runtime imports (type-only): the progress harness compiles this module
 * with nothing beyond the domain types — no React, no supabase, no theme.
 */

import type { CategoryBudget } from '@/types';

/**
 * The budget rows the settings screen edits: one per merged catalog slug
 * (canonical-first + own-custom tail — the merge order is pinned by
 * `mergeCategoryCatalog`, this helper mirrors the keys as-is).
 *
 * While the catalog is still unknown (initial `{}` from
 * `useCategoryCatalog`) the form falls back to the caller's static canonical
 * keys, so the list renders immediately with the pre-PR7 shape; the moment
 * the catalog resolves, every custom slug joins the list.
 */
export function budgetKeysFromCatalog(
  catalog: Record<string, unknown> | null | undefined,
  fallbackKeys: readonly string[],
): string[] {
  const keys = Object.keys(catalog ?? {});
  return keys.length > 0 ? keys : [...fallbackKeys];
}

/**
 * The screen's existing inline parse, lifted verbatim: trim → parseInt →
 * bounded at 0. Empty, non-numeric, or negative input becomes 0 — which the
 * API layer converts into delete-on-zero, so clearing a field deletes its row.
 */
export function parseBudgetAmount(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return raw.trim() !== '' && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : 0;
}

export interface CategoryBudgetDraft {
  category_slug: string;
  amount: number;
}

/**
 * Every catalog key mapped to its parsed draft amount (zero for empty or
 * invalid). Zero rows are NOT filtered here — `upsertCategoryBudgets` turns
 * amount <= 0 into DELETE, so one batch keeps upsert + delete semantics in a
 * single payload. Same rows, same order as the rendered form.
 */
export function budgetSavePayload(
  keys: readonly string[],
  drafts: Readonly<Record<string, string>>,
): CategoryBudgetDraft[] {
  return keys.map((key) => ({
    category_slug: key,
    amount: parseBudgetAmount(drafts[key] ?? ''),
  }));
}

/**
 * Prefill the draft map from the persisted budgets for the queried month;
 * every other key starts empty ('').
 */
export function seedBudgetDrafts(
  keys: readonly string[],
  existing: readonly CategoryBudget[],
): Record<string, string> {
  const bySlug = new Map(existing.map((row) => [row.category_slug, row]));
  const drafts: Record<string, string> = {};
  for (const key of keys) {
    const row = bySlug.get(key);
    drafts[key] = row ? String(row.amount) : '';
  }
  return drafts;
}

/**
 * CRITICAL-1 (PR 7 re-gate): merge a freshly computed seed into an ALREADY
 * DIRTY draft map without overwriting user input.
 *
 * Only keys the user has never seen (missing from `current`) are added, using
 * their `next` value — a server amount when one exists (a budget that already
 * exists must be SEEN, never silently deleted by a zero payload on save),
 * else '' (the "no budget set" default). Existing drafts are returned
 * untouched. When there is nothing new to seed the SAME `current` reference
 * is returned, so React bails out of the setState (no re-render loop).
 *
 * This is what lets the seed effect run while the form is dirty: a catalog
 * that heals mid-draft (failed read → canonical fallback → user types →
 * refetch adds custom keys) expands the editable key set, and every new key
 * must be seeded before the user can save.
 */
export function mergeBudgetDraftSeeds(
  current: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): Record<string, string> {
  const missing = Object.keys(next).filter((key) => !(key in current));
  if (missing.length === 0) return current;
  const merged: Record<string, string> = { ...current };
  for (const key of missing) merged[key] = next[key];
  return merged;
}