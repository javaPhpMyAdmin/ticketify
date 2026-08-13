# Proposal: parse-ticket list-mode fallback

## Intent (Why)

Users try to scan handwritten shopping lists or screenshots of phone notes with items and prices. The current parser is strictly receipt-shaped and rejects these images, showing only a generic "No se pudo procesar el recibo" message. We want the scanner to fall back to a simpler "list mode" that extracts items + prices and lets the user fill in store/date/payment on the review screen.

## Scope

### In scope
- Add a second parsing pass to `parse-ticket`: when strict receipt parsing fails, try a relaxed "list mode" prompt.
- List mode returns only `items[]` with `name`, `quantity`, `unit_price`, `total_price` and optional receipt metadata.
- Default missing receipt metadata on the edge response so the client review screen can edit it.
- Surface the fallback to the client so the UI can show a "detected as list" hint (optional for this slice).
- Add tests for list-mode parsing.

### Out of scope
- Manual entry form (option B).
- New camera UI or scan-mode selector.
- Changes to the save flow beyond tolerating empty store/date/payment.

## Approach

1. Extend `parse-ticket/index.ts` with a `callGeminiListMode` function and a relaxed prompt.
2. In the handler: try receipt mode first; on `ParseError`, try list mode once; on success return the list with default metadata.
3. Relax client-side validation in `toClientReceipt` so missing `store_name` / `purchase_date` / `payment_method` defaults to empty/"other" instead of throwing.
4. Redeploy the edge function.

## Risks

- List mode may hallucinate items from blank paper or irrelevant images.
- Two Gemini calls on failure double the latency and API cost for unparseable images.
- Default values could let users save receipts without store/date if review screen doesn't enforce them.
