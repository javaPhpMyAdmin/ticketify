# Specs: parse-ticket list-mode fallback

## Functional Requirements

### REQ-LIST-1
When the receipt-mode parser returns a `ParseError`, the edge function MUST attempt a second Gemini call using the list-mode prompt before returning `parse_failed` to the client.

### REQ-LIST-2
The list-mode prompt MUST ask Gemini to extract a JSON array of items with `name`, `quantity`, `unit_price`, `total_price`, and optional `suggested_category_slug`, plus the receipt-level optional field `currency` (an ISO 4217 code). It MUST NOT require `store_name`, `purchase_date`, `payment_method`, `card_brand`, or `card_type`.

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/parse-ticket-list-mode/spec.md`. Previously: no `currency` field anywhere in the list-mode contract — items and magnitudes only.

#### Scenario: List-mode parse exposes the detected unit

- GIVEN an image that fails receipt mode but yields items and prices in list mode
- WHEN the edge function completes the list-mode parse
- THEN the response carries `currency` when the model detected one
- AND the item fields and list-mode defaults are unchanged

#### Scenario: Absent currency does not fail the parse

- GIVEN a list-mode parse that produces no `currency` field
- WHEN the client receives the response
- THEN the parse still succeeds and downstream rendering falls back to the
  viewer's profile currency

### REQ-LIST-3
List-mode items MUST use the same validation rules as receipt-mode items for numeric fields, empty names, and category slugs. When `currency` is present it MUST be validated against the supported-currency catalog (`currency-universality` REQ-1); a value outside the catalog MUST be dropped rather than propagated to the client.

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/parse-ticket-list-mode/spec.md`. Previously: numeric, empty-name, and category-slug validation only — no unit validation.

#### Scenario: Out-of-catalog unit is dropped

- GIVEN a list-mode response whose `currency` is not in `SUPPORTED_CURRENCIES`
- WHEN validation runs
- THEN the value is not propagated to the client
- AND the receipt falls back to the viewer's profile currency

### REQ-LIST-4
If list mode succeeds, the edge function MUST return a `ParsedReceipt` shape with:
- `store_name`: `""` (empty string)
- `purchase_date`: current UTC date as `YYYY-MM-DD`
- `total`: sum of `total_price` across items
- `payment_method`: `"other"`
- `card_brand`: `null`
- `card_type`: `null`
- `currency`: the catalog-validated detected unit, omitted when unknown
- `items`: the parsed items

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/parse-ticket-list-mode/spec.md`. Previously: the shape had no `currency` member.

#### Scenario: Shape carries a validated unit

- GIVEN a successful list-mode parse of a note written in a foreign currency
- WHEN the edge function returns the `ParsedReceipt`
- THEN `currency` holds a code from `SUPPORTED_CURRENCIES`
- AND every other member of the shape matches the pre-change contract

#### Scenario: Shape remains valid without a unit

- GIVEN a successful list-mode parse with no detectable currency
- WHEN the edge function returns the `ParsedReceipt`
- THEN the response omits `currency` and no other member is altered or omitted

### REQ-LIST-5
If list mode also fails, the edge function MUST return `parse_failed` with the original receipt-mode error message (or a generic message) and MUST NOT consume a scan quota slot.

### REQ-LIST-6
The client `toClientReceipt` function MUST tolerate missing or empty `store_name` and `purchase_date` by defaulting to `""` and current date respectively, so the review screen can render and edit the draft.

### REQ-LIST-7
Quota consumption MUST remain after a successful parse in either mode; failed parses in either mode MUST NOT consume quota.

## Acceptance Scenarios

### SCENARIO-LIST-1: Handwritten list parses successfully
**Given** a clear photo of a handwritten list with items and prices  
**When** the user scans it  
**Then** the edge function returns a draft with items, empty store, today's date, payment method "other", and the review screen shows the items for editing.

### SCENARIO-LIST-2: Unparseable image still fails
**Given** a photo with no readable text or prices  
**When** the user scans it  
**Then** the edge function returns `parse_failed` and the user's scan quota is unchanged.

### SCENARIO-LIST-3: Normal receipt still works
**Given** a printed receipt  
**When** the user scans it  
**Then** receipt mode succeeds on the first pass and returns full receipt metadata.

### SCENARIO-LIST-4: Screenshot of phone notes parses as list
**Given** a screenshot of phone notes with items and prices  
**When** the user scans it  
**Then** receipt mode fails, list mode succeeds, and the draft is seeded with the items.

## Non-Functional Requirements

- Maximum two Gemini calls per scan request (receipt mode + one list-mode fallback).
- List-mode latency MUST be bounded by the same `GEMINI_TIMEOUT_MS` as receipt mode.
- No new backend tables or migrations required.
