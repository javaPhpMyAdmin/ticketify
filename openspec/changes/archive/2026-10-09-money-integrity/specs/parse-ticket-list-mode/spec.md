# Delta — parse-ticket-list-mode

> Change: `money-integrity`. The list-mode fallback now surfaces the receipt's
> unit as an optional, catalog-validated `currency`, so a list-mode scan is not
> structurally unit-less while receipt mode carries one.

## MODIFIED Requirements

### REQ-LIST-2

The list-mode prompt MUST ask Gemini to extract a JSON array of items with
`name`, `quantity`, `unit_price`, `total_price`, and optional
`suggested_category_slug`, plus the receipt-level optional field `currency`
(an ISO 4217 code). It MUST NOT require `store_name`, `purchase_date`,
`payment_method`, `card_brand`, or `card_type`.

(Previously: no `currency` field anywhere in the list-mode contract — items
and magnitudes only.)

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

List-mode items MUST use the same validation rules as receipt-mode items for
numeric fields, empty names, and category slugs. When `currency` is present it
MUST be validated against the supported-currency catalog
(`currency-universality` REQ-1); a value outside the catalog MUST be dropped
rather than propagated to the client.

(Previously: numeric, empty-name, and category-slug validation only — no unit
validation.)

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

(Previously: the shape had no `currency` member.)

#### Scenario: Shape carries a validated unit

- GIVEN a successful list-mode parse of a note written in a foreign currency
- WHEN the edge function returns the `ParsedReceipt`
- THEN `currency` holds a code from `SUPPORTED_CURRENCIES`
- AND every other member of the shape matches the pre-change contract

#### Scenario: Shape remains valid without a unit

- GIVEN a successful list-mode parse with no detectable currency
- WHEN the edge function returns the `ParsedReceipt`
- THEN the response omits `currency` and no other member is altered or omitted
