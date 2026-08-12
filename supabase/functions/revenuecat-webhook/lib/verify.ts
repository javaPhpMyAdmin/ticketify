/**
 * Constant-time shared-secret compare for the RevenueCat webhook
 * (REQ-SYNC-3 / WARNING-3).
 *
 * The function:
 *   1. SHA-256-digests BOTH sides regardless of input length, so a length
 *      mismatch does not produce a different code path or a faster reject.
 *   2. Walks the two 32-byte digests with an XOR-accumulator that visits
 *      every byte even after a mismatch — no early return on the first
 *      differing byte, no length short-circuit. The function returns true
 *      iff the accumulator stayed zero, i.e. every byte matched.
 *
 * Pure with respect to its inputs: the only ambient dependency is
 * `crypto.subtle.digest` (the WebCrypto API available in both Deno and
 * modern Node), which makes the helper mirrorable in the future node
 * `.mjs` test harness (M8.1). No Deno globals, no I/O.
 *
 * Performance is intentionally not optimized for the hot path — the
 * function is called once per webhook delivery, the 32-byte digest
 * comparison is ~constant-time regardless, and a shorter / faster
 * implementation would re-introduce the timing oracle the design
 * pinned against.
 */

/**
 * Compare two shared-secret strings in constant time. Returns true iff
 * both inputs digest to the same 32-byte SHA-256 value.
 *
 * - Missing/wrong/empty/length-mismatch all funnel through the same
 *   digest+loop, so the caller can answer with a single 401 envelope
 *   without leaking which condition matched.
 * - The function does not throw on bad input; it simply returns false.
 *   The webhook handler must not let an exception here become a 500.
 */
export async function verifySecret(
  provided: string,
  expected: string,
): Promise<boolean> {
  const a = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(provided),
  );
  const b = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(expected),
  );

  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);

  // Non-short-circuiting loop: every byte is XORed regardless of how
  // early a mismatch appears. The final check on the digest length is
  // not on the early-exit path (both paths always run to completion)
  // because both arrays come from a fixed-size SHA-256 (32 bytes), so
  // their lengths are guaranteed equal — but the call keeps the length
  // guard as defense-in-depth in case the underlying primitive ever
  // returns a different shape.
  let diff = av.length ^ bv.length;
  const len = Math.min(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    diff |= av[i] ^ bv[i];
  }
  return diff === 0;
}
