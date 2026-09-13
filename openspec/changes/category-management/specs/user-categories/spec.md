# User Categories Specification

## Purpose

User-scoped custom categories layered over the canonical 13-slug taxonomy (`EXPENSE_CATEGORIES`). Users create need/want categories from the category picker and assign them to items at add AND edit time in both the manual entry flow and the camera scan review flow. Custom rows live in `public.categories` with a nullable `user_id` (null = global canonical row), are protected by partial unique indexes and RLS, render across every display surface with their own slug/label/color/kind, cannot be deleted while in use, and never leak into the parser (which stays on the canonical 13 — custom assignment is always post-parse). `EXPENSE_CATEGORIES` remains the pure fallback source.

## Requirements

### Requirement: User-Scoped Category Storage

The system MUST store custom categories in `public.categories` with a nullable `user_id` column (uuid, FK profiles): null denotes a global canonical row, a non-null value denotes a user-scoped custom row. The existing global UNIQUE(slug) constraint MUST be replaced by two partial unique indexes — UNIQUE(slug) WHERE user_id IS NULL and UNIQUE(user_id, slug) WHERE user_id IS NOT NULL. Row-level security MUST restrict insert, update, and delete to the caller's own rows (`auth.uid() = user_id`); select SHALL keep current behavior (authenticated users read all rows). A CHECK constraint MUST keep `kind` in ('need','want'). The migration SHALL be additive and nullable — no backfill, no data rewrite, no cascade deletes — and the 13 canonical rows MUST remain unchanged with `user_id = null`.

#### Scenario: Create a custom category

- GIVEN a signed-in user with no "Delivery" category
- WHEN the user creates a custom category named "Delivery" with kind 'want', an icon, and a color
- THEN a row is inserted with `user_id = auth.uid()`, slug 'delivery', and the chosen icon, color, and kind
- AND the row appears in that user's picker and display catalog

#### Scenario: Same slug under different users

- GIVEN user A created slug 'delivery' and user B has no such row
- WHEN user B creates a custom category with slug 'delivery'
- THEN the insert succeeds (the partial index allows one row per slug per user)

#### Scenario: Duplicate slug for the same user is rejected

- GIVEN the user already has a custom row with slug 'delivery'
- WHEN the user inserts another row with slug 'delivery'
- THEN the insert fails on the (user_id, slug) partial unique index and no row is created

#### Scenario: Canonical rows unchanged by migration

- GIVEN the migration has run
- WHEN the 13 canonical rows are read
- THEN each has `user_id = null` with the same slug, name, kind, icon, and color as before

#### Scenario: RLS blocks cross-user writes

- GIVEN user A owns a custom row
- WHEN user B attempts to update or delete that row
- THEN zero rows are affected (RLS filters the write)

#### Scenario: Invalid kind is rejected

- GIVEN a custom category creation submits a kind other than 'need' or 'want'
- WHEN the insert runs
- THEN the insert fails on the CHECK constraint and no row is created

### Requirement: Category Creation Flow

The picker MUST expose a create affordance. The creation flow MUST collect a name, derive a slug, validate the slug against the canonical 13 AND the caller's own custom rows, collect a palette color, and require an explicit need/want selection before confirming. A slug colliding with a canonical slug MUST be blocked with user-visible feedback; a slug colliding with one of the caller's own custom rows MUST also be blocked. The row MUST be created before the slug can be assigned to any item — a custom slug without a DB row MUST never reach the save seam.

#### Scenario: Create and immediately assign

- GIVEN the user is in the picker's create form
- WHEN the user enters "Delivery", picks a color, chooses 'want', and confirms
- THEN a 'delivery' row is created, selected, and assignable in the same session

#### Scenario: Collision with canonical slug

- GIVEN the user enters "Supermercado" (slugifies to 'supermercado', a canonical slug)
- WHEN creation is confirmed
- THEN the flow shows feedback that the category already exists and creates no row

#### Scenario: Collision with own custom slug

- GIVEN the user already created slug 'delivery'
- WHEN the user tries to create "Delivery" again
- THEN the flow shows feedback and creates no row

#### Scenario: Missing kind selection

- GIVEN the creation form has a name and color but no kind
- WHEN the user confirms
- THEN creation is blocked until a need/want choice is made (the CHECK constraint never sees a null kind)

### Requirement: Picker in Item Editor

The item editor MUST stack the category picker and round-trip the chosen category with its parent so the item saves with `category_id`, in BOTH the manual entry flow and the camera scan review flow, and in BOTH add and edit modes. The picker MUST list the canonical 13 plus the caller's custom categories and MUST offer the create affordance. Assigning or creating a category SHALL be possible at add time and at edit time.

#### Scenario: Assign at add time (manual)

- GIVEN the user opens the item editor to add a line item manually
- WHEN the user taps the category row and selects "Carnicería"
- THEN the item is saved with `category_id` resolved from canonical slug 'carnes'

#### Scenario: Assign at edit time (manual)

- GIVEN the user opens the item editor on an existing item with category 'snacks'
- WHEN the user changes the selection to 'servicios' and saves
- THEN the item round-trips the new choice and persists `category_id` for 'servicios'

#### Scenario: Create and assign in camera review

- GIVEN the camera scan review flow shows an item with no category
- WHEN the user opens the picker from the editor, creates "Delivery" (want), and assigns it
- THEN the item is confirmed with `category_id` pointing at the new 'delivery' row

#### Scenario: No category chosen

- GIVEN the user saves an item without opening the picker
- THEN the item is saved with `category_id = null` (optionality unchanged from current behavior)

### Requirement: Display Catalog Merge

All category display surfaces — chips, home strip, history, analytics, receipts detail, pro charts, and the donut — MUST render a custom category with its own slug, label, and color from its DB row instead of auto-bucketing to 'otros' whenever a user row exists for that slug. Unknown slugs with NO user row MUST keep bucketing to 'otros' (deterministic fallback preserved). The canonical 13 MUST keep current behavior. The custom category's kind MUST participate in donut and analytics need/want classification exactly like canonical categories.

#### Scenario: Custom category renders its own visuals

- GIVEN the user has a 'delivery' row (want) with purchases
- WHEN chips, home strip, history, analytics, receipts detail, pro charts, or the donut render that slug
- THEN the row's label, color, and icon appear — not 'otros'

#### Scenario: Unknown slug without a row falls back to 'otros'

- GIVEN a slug that is not canonical and has no user row (legacy data)
- WHEN a display surface renders it
- THEN the 'otros' visual is used (unchanged fallback)

#### Scenario: Kind drives donut and analytics

- GIVEN a custom category with kind 'need' and purchases
- WHEN the donut or analytics need/want classification renders
- THEN the purchases count under 'need' with the custom category's label and color

### Requirement: Block-Delete Policy

The system MUST NOT delete a custom category that has associated purchases ("in use"); the delete MUST be blocked, surfaced with an explanation, and the flow MUST offer reassignment of the category's purchases to another category before deletion is allowed. There SHALL be NO silent fallback — blocking or performing a deletion MUST NOT re-bucket purchases to 'otros'. A custom category with no purchases MAY be deleted.

#### Scenario: Delete blocked while in use

- GIVEN a 'delivery' category with 5 purchases
- WHEN the user attempts to delete it
- THEN deletion is blocked with an explanation that the category is in use and no purchase is re-bucketed

#### Scenario: Reassign then delete

- GIVEN the user is offered reassignment after a blocked delete
- WHEN the user moves all 'delivery' purchases to 'otros', retries deletion, and the category is now empty
- THEN the category is deleted and the reassigned purchases keep their new category

#### Scenario: Delete succeeds when empty

- GIVEN a custom category with zero purchases
- WHEN the user deletes it
- THEN the row is removed and no purchase is affected

### Requirement: Parser and Save Seam Guardrails

The parser MUST keep emitting only the 13 canonical slugs; custom categories SHALL be user-assigned post-parse. Parser output for unknown slugs MUST remain null / SIN CATEGORÍA as today. The save seam (slug → category uuid FK resolution) MUST resolve BOTH canonical slugs AND the caller's custom slugs, so a custom slug always maps to a real row before save. Behavior of the canonical 13 MUST NOT change.

#### Scenario: Parser output unchanged

- GIVEN a receipt whose parser resolves no canonical slug
- WHEN the scan review flow loads
- THEN the item keeps current behavior (null / SIN CATEGORÍA) and no custom slug is emitted

#### Scenario: Custom slug resolves at save

- GIVEN the user assigned 'delivery' (a custom row) to an item
- WHEN the save seam resolves slug → uuid
- THEN `category_id` resolves to the 'delivery' row's uuid and the purchase persists under that category

#### Scenario: Canonical slug resolution unchanged

- GIVEN an item with canonical slug 'servicios'
- WHEN the save seam resolves category ids
- THEN the resolution behaves identically to before this change