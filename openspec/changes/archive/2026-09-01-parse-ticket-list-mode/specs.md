# Specs: parse-ticket list-mode fallback

## Functional Requirements

### REQ-LIST-1
When the receipt-mode parser returns a `ParseError`, the edge function MUST attempt a second Gemini call using the list-mode prompt before returning `parse_failed` to the client.

### REQ-LIST-2
The list-mode prompt MUST ask Gemini to extract a JSON array of items with `name`, `quantity`, `unit_price`, `total_price`, and optional `suggested_category_slug`. It MUST NOT require `store_name`, `purchase_date`, `payment_method`, `card_brand`, or `card_type`.

### REQ-LIST-3
List-mode items MUST use the same validation rules as receipt-mode items for numeric fields, empty names, and category slugs.

### REQ-LIST-4
If list mode succeeds, the edge function MUST return a `ParsedReceipt` shape with:
- `store_name`: `""` (empty string)
- `purchase_date`: current UTC date as `YYYY-MM-DD`
- `total`: sum of `total_price` across items
- `payment_method`: `"other"`
- `card_brand`: `null`
- `card_type`: `null`
- `items`: the parsed items

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
