/**
 * UUID v4 validator (REQ-SYNC / WARNING-2).
 *
 * The webhook accepts only `event.app_user_id` values that look like a
 * UUID v4 — the ledger's `user_id` column is a Postgres `uuid`, so any
 * non-uuid value would either crash the RPC or land in the ordering
 * check with a coerced string. We validate the shape BEFORE any DB
 * touch so a malicious or malformed payload returns 200 no-op without
 * leaking timing or hitting the database.
 *
 * Pure function, no globals, no I/O — mirrorable in the future node
 * `.mjs` test harness (M8.1).
 *
 * The regex is the canonical UUID v4 pattern: the third group's first
 * nibble must be `4` (version) and the fourth group's first nibble must
 * be `8`, `9`, `a`, or `b` (RFC 4122 variant `10xx`). Case-insensitive
 * because Postgres `uuid` accepts both casings.
 */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns true iff `s` matches the UUID v4 grammar.
 * The function does not throw and does not allocate beyond the regex
 * match — safe to call on every webhook delivery.
 */
export function isUuid(s: string): boolean {
  if (typeof s !== 'string') return false;
  return UUID_V4_REGEX.test(s);
}
