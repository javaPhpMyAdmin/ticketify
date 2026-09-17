/**
 * Pure typed-confirmation matcher (REQ-ACCTDEL-5).
 *
 * The TypedConfirmation organism and the delete-account screen both rely on
 * a case-insensitive trimmed string equality test. Extracted here so the
 * matching rule is testable from a node harness without rendering React or
 * pulling in the native TextInput module.
 *
 * Rule: `input.trim().toLowerCase() === prompt.trim().toLowerCase()`.
 * - A trailing space, different casing, or extra characters re-disables
 *   the primary button (matches the spec's "Final button enables only on
 *   match" scenario).
 * - Empty / whitespace-only inputs never match (the button stays disabled
 *   until the user types something substantive).
 */
export function matchesTypedConfirmation(input: string, prompt: string): boolean {
  return input.trim().toLowerCase() === prompt.trim().toLowerCase();
}
