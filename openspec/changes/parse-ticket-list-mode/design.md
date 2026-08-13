# Design: parse-ticket list-mode fallback

## Edge Function Changes

### File: `supabase/functions/parse-ticket/index.ts`

1. Add a second prompt constant `LIST_PROMPT` that requests only items with prices. Example schema:
   ```json
   {
     "items": [
       {
         "name": "string",
         "quantity": 1,
         "unit_price": 0.00,
         "total_price": 0.00,
         "suggested_category_slug": "string | null"
       }
     ]
   }
   ```

2. Add `callGeminiListMode(imageBase64, mimeType)` function:
   - Reuses the same Gemini URL and timeout.
   - Sends `LIST_PROMPT`.
   - Parses the response with `JSON.parse` and validates the items array.
   - Throws `ParseError` on failure.

3. Add `parseListJson(raw)` helper:
   - Validates `raw.items` is a non-empty array.
   - Maps each entry through `parseItem` (reuse existing item validation).
   - Returns `{ items, total }`.

4. Modify the HTTP handler:
   ```
   try {
     parsed = await callGemini(...); // receipt mode
   } catch (err) {
     if (err instanceof ParseError) {
       try {
         parsed = await callGeminiListMode(...);
       } catch (listErr) {
         // log and return original receipt parse error
       }
     }
     // non-ParseError still returns 500
   }
   ```

5. When list mode succeeds, construct a `ParsedReceipt` with defaults:
   - `store_name`: `""`
   - `purchase_date`: `currentDateYmd()`
   - `total`: sum of item totals
   - `payment_method`: `"other"`
   - `card_brand`: `null`
   - `card_type`: `null`

### Quota

Keep the existing consume-after-parse flow. List mode success consumes one slot; list mode failure does not.

### Client Changes

#### File: `src/features/tickets/api.ts`

1. Update `toClientReceipt` to default missing/empty metadata:
   - `store`: `edge.store_name ?? ""`
   - `date`: validate `edge.purchase_date` format; if missing/invalid, use today's date.
   - `payment_method`: already degrades to `"other"`.
   - `card_brand` / `card_type`: already degrade to `null`.

2. The review screen already allows editing store/date/payment, so no new UI is needed for this slice.

## Testing

- Extend `scripts/test-parse-ticket.mjs` (or create one) with list-mode cases.
- Add unit harness for `parseListJson` logic if extractable.
- Manual test: scan a handwritten list and a screenshot of notes.

## Deployment

- Redeploy `parse-ticket` with `npx supabase functions deploy parse-ticket --import-map supabase/functions/deno.json`.
- Client change ships in the next APK build.
