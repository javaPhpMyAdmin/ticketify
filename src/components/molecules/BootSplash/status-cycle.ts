/**
 * Pure, framework-free helpers for the BootSplash status text cycle.
 *
 * `BootSplash.tsx` cycles through 3 status messages (Loading,
 * Syncing, Ready) every `slotMs` (2400ms). The component owns the
 * timer + the fade-in/fade-out, but it asks this helper to pick the
 * ACTIVE index for the current elapsed millisecond window so the
 * math stays deterministic and harness-testable (the helper has no
 * clock, no globals — table-driven input).
 *
 * The component feeds `Date.now()` for `nowMs` once per tick, so
 * the helper never blocks the boot path; the cycle is also clamped
 * against `totalMessages === 0` and negative `nowMs` defensively.
 */

/**
 * Pick the active status index given the elapsed ms window.
 *
 * @param startedAtMs absolute timestamp when the cycle started
 * @param nowMs       absolute timestamp for the current tick
 * @param slotMs      per-message slot length (2400ms by spec)
 * @param totalMessages total slots in the cycle (3 by spec)
 * @returns           `0 <= index < totalMessages` (clamped to 0 when
 *                    totalMessages is 0 or nowMs is before startedAtMs)
 */
export function pickStatusIndex(
  startedAtMs: number,
  nowMs: number,
  slotMs: number,
  totalMessages: number,
): number {
  if (totalMessages <= 0) return 0;
  const safeSlot = Math.max(1, slotMs);
  if (nowMs <= startedAtMs) return 0;
  const elapsed = nowMs - startedAtMs;
  return Math.floor(elapsed / safeSlot) % totalMessages;
}
